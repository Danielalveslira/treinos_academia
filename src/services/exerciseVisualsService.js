import { supabase } from '../supabase/config'
import { compressImage } from '../utils/imageCompression'

// Administração da mídia oficial dos exercícios (só superadmin -- RLS/RPCs/Edge Functions
// recusam qualquer outro; ver supabase/migrations/20261020000001_exercise_visuals.sql).
// Fluxo: allocate_exercise_visual_set (reserva versão + paths) -> bytes direto pro bucket
// privado de rascunhos -> Edge Function exercise-visual-confirm (valida WebP no servidor) ->
// review -> Edge Function publish-exercise-visual -> exercise_catalog.published_media_refs.
// Componentes/páginas nunca falam com o Supabase: passam por este serviço via hook.
export const DRAFTS_BUCKET = 'exercise-visual-drafts'
export const PUBLIC_BUCKET = 'exercise-visuals'
export const EXERCISE_VISUAL_MAX_DIMENSION = 1024
export const EXERCISE_VISUAL_THUMBNAIL_DIMENSION = 320
export const MAX_VISUAL_BYTES = 2 * 1024 * 1024
const DRAFT_URL_TTL_SECONDS = 600
export const PAGE_SIZE = 20

const ERROR_MESSAGES = {
  NOT_AUTHENTICATED: 'Sua sessão expirou. Faça login novamente.',
  FORBIDDEN: 'Apenas superadmin pode gerenciar as imagens dos exercícios.',
  INVALID_IMAGE:
    'O servidor recusou uma das imagens (precisa ser WebP válida e dentro do tamanho permitido).',
  IMAGE_TOO_LARGE: 'Imagem muito pesada mesmo após a compressão (máx. 2MB). Use outra imagem.',
  INCOMPLETE_VISUAL_SET: 'O conjunto está incompleto: início, fim e miniatura são obrigatórios.',
  INVALID_STATE:
    'Esse conjunto não está mais no estado esperado. Atualize a lista e tente de novo.',
  UPLOAD_NOT_AUTHORIZED: 'Upload não autorizado para esse conjunto.',
  CATALOG_NOT_FOUND: 'Exercício não encontrado ou inativo.',
  RATE_LIMITED: 'Muitas alocações seguidas. Aguarde um pouco e tente de novo.',
  COPY_FAILED: 'Falha ao copiar as imagens para o armazenamento público. Tente publicar novamente.',
  MISSING_FILES: 'Selecione as duas imagens (posição inicial e final).',
  MISSING_FILE: 'Um dos arquivos não chegou ao servidor. Envie as imagens novamente.',
}

export function describeVisualError(error) {
  // Erros de RPC chegam com o código do SQLSTATE em `code` e o nosso código ('FORBIDDEN'...) em `message`.
  return (
    ERROR_MESSAGES[error?.message] ||
    ERROR_MESSAGES[error?.code] ||
    'Não foi possível concluir a operação. Tente novamente.'
  )
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

// Mesma normalização de public._normalize_search_value (minúsculas, sem acento, espaços colapsados),
// sem os caracteres que têm significado em filtros do PostgREST/ILIKE.
export function normalizeSearchTerm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[%_\\,()*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function publishedUrl(path) {
  return supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(path)?.data?.publicUrl || null
}

export async function listCatalogForVisuals({
  q,
  onlyMissing = false,
  limit = PAGE_SIZE,
  offset = 0,
} = {}) {
  let query = supabase
    .from('exercise_catalog')
    .select(
      'id, name, primary_muscle, muscles, equipment, category, difficulty, force, mechanic, instructions, published_media_refs',
      { count: 'exact' }
    )
    .eq('is_active', true)
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1)
  const term = normalizeSearchTerm(q)
  if (term) query = query.ilike('name_normalized', `%${term}%`)
  // published_media_refs só ganha "version" quando uma versão é publicada (o default é {"images":[]}).
  if (onlyMissing) query = query.is('published_media_refs->version', null)
  const { data, error, count } = await query
  if (error) throw error
  return { data: data || [], total: count ?? 0 }
}

// Cobertura do painel: quantos exercícios ativos já têm imagem oficial publicada.
export async function getVisualCoverage() {
  const [total, published] = await Promise.all([
    supabase
      .from('exercise_catalog')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    supabase
      .from('exercise_catalog')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .not('published_media_refs->version', 'is', null),
  ])
  if (total.error) throw total.error
  if (published.error) throw published.error
  const totalCount = total.count ?? 0
  const publishedCount = published.count ?? 0
  return {
    total: totalCount,
    published: publishedCount,
    missing: Math.max(totalCount - publishedCount, 0),
    percent: totalCount ? (publishedCount / totalCount) * 100 : 0,
  }
}

export async function getActiveStyleProfile() {
  const { data, error } = await supabase
    .from('exercise_visual_style_profiles')
    .select('id, name, version, base_prompt, negative_rules')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// Histórico completo de um exercício (mais novo primeiro), com a URL de pré-visualização de cada
// arquivo: pública para o que já está no bucket exercise-visuals, assinada (10 min) para rascunhos.
export async function listVisualSets(catalogId) {
  const { data, error } = await supabase
    .from('exercise_visual_sets')
    .select(
      'id, catalog_id, version, status, generation_source, prompt_version, created_by, approved_by, metadata, created_at, submitted_at, approved_at, published_at, assets:exercise_visual_assets(role, storage_bucket, storage_path, width, height, byte_size)'
    )
    .eq('catalog_id', catalogId)
    .order('version', { ascending: false })
  if (error) throw error
  return Promise.all((data || []).map(withPreviewUrls))
}

async function withPreviewUrls(set) {
  const urls = {}
  const drafts = []
  for (const asset of set.assets || []) {
    if (asset.storage_bucket === PUBLIC_BUCKET) urls[asset.role] = publishedUrl(asset.storage_path)
    else if (asset.storage_bucket === DRAFTS_BUCKET && set.status !== 'allocated')
      drafts.push(asset)
  }
  if (drafts.length) {
    const { data, error } = await supabase.storage.from(DRAFTS_BUCKET).createSignedUrls(
      drafts.map((asset) => asset.storage_path),
      DRAFT_URL_TTL_SECONDS
    )
    // Sem preview o conjunto continua listado (e revisável pelo metadado); só não mostra a imagem.
    if (!error) {
      drafts.forEach((asset, index) => {
        if (data?.[index]?.signedUrl) urls[asset.role] = data[index].signedUrl
      })
    }
  }
  return { ...set, previewUrls: urls }
}

async function callAdminFunction(name, body) {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr || !sessionData?.session) throw codedError('NOT_AUTHENTICATED')
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify(body),
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) throw codedError(payload?.error || 'CONFIRM_FAILED')
  return payload
}

async function toVisualBlob(file, maxDimension) {
  const blob = await compressImage(file, { maxDimension })
  if (blob.size > MAX_VISUAL_BYTES) throw codedError('IMAGE_TOO_LARGE')
  return blob
}

// start/end viram WebP de até 1024px; a miniatura (320px) sai da posição inicial. Tudo é convertido no
// navegador (imageCompression rejeita bytes que não decodificam como imagem) e o servidor valida de
// novo no confirm. start e end são obrigatórios; a miniatura é melhor-esforço: se não puder ser gerada
// ou enviada, o conjunto segue só com start/end (o servidor aceita) em vez de falhar o envio inteiro.
// Devolve o conjunto já em `review`.
export async function uploadVisualSet({
  catalogId,
  startFile,
  endFile,
  generationSource = 'manual_upload',
  promptVersion = null,
  metadata = {},
}) {
  if (!startFile || !endFile) throw codedError('MISSING_FILES')

  const [start, end] = await Promise.all([
    toVisualBlob(startFile, EXERCISE_VISUAL_MAX_DIMENSION),
    toVisualBlob(endFile, EXERCISE_VISUAL_MAX_DIMENSION),
  ])
  let thumbnail = null
  try {
    thumbnail = await toVisualBlob(startFile, EXERCISE_VISUAL_THUMBNAIL_DIMENSION)
  } catch (error) {
    console.warn('[exerciseVisualsService] miniatura não gerada, seguindo sem ela:', error)
  }

  const { data: allocation, error: allocateErr } = await supabase.rpc(
    'allocate_exercise_visual_set',
    {
      p_catalog_id: catalogId,
      p_generation_source: generationSource,
      p_prompt_version: promptVersion,
      p_metadata: metadata,
    }
  )
  if (allocateErr) throw allocateErr

  const upload = (role, blob) =>
    supabase.storage.from(DRAFTS_BUCKET).upload(allocation.assets[role].path, blob, {
      contentType: 'image/webp',
      upsert: false,
    })
  for (const [role, blob] of [
    ['start', start],
    ['end', end],
  ]) {
    const { error: uploadErr } = await upload(role, blob)
    if (uploadErr) throw uploadErr
  }
  if (thumbnail) {
    const { error: thumbErr } = await upload('thumbnail', thumbnail)
    if (thumbErr)
      console.warn('[exerciseVisualsService] miniatura não enviada, seguindo sem ela:', thumbErr)
  }

  return callAdminFunction('exercise-visual-confirm', { visualSetId: allocation.visualSetId })
}

export function publishVisualSet(visualSetId) {
  return callAdminFunction('publish-exercise-visual', { visualSetId })
}

export async function rejectVisualSet(visualSetId, reason = null) {
  const { data, error } = await supabase.rpc('reject_exercise_visual_set', {
    p_set_id: visualSetId,
    p_reason: reason?.trim() || null,
  })
  if (error) throw error
  return data
}

export async function restoreVisualSet(visualSetId) {
  const { data, error } = await supabase.rpc('restore_exercise_visual_version', {
    p_set_id: visualSetId,
  })
  if (error) throw error
  return data
}
