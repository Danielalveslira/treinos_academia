import { supabase } from '../supabase/config'
import { compressImage } from '../utils/imageCompression'
import { perceptualHashOfBlob } from '../utils/perceptualHash'
import { onPageCacheClear } from '../utils/pageCache'

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
  IMAGE_METADATA_NOT_ALLOWED:
    'Uma das imagens contém metadados (EXIF/XMP). Exporte a imagem novamente sem metadados e envie de novo.',
  INCOMPLETE_VISUAL_SET: 'O conjunto está incompleto: início e fim são obrigatórios.',
  INVALID_STATE:
    'Esse conjunto não está mais no estado esperado. Atualize a lista e tente de novo.',
  INVALID_TRANSITION: 'Essa mudança de estado não é permitida. Atualize a lista e tente de novo.',
  INTEGRITY_MISMATCH:
    'O arquivo do rascunho mudou depois da validação. Envie as imagens novamente.',
  STYLE_PROFILE_UNAVAILABLE: 'Não foi possível carregar o padrão visual. Tente novamente.',
  IDEMPOTENCY_KEY_REUSED: 'Esse envio já foi usado para outro exercício. Envie novamente.',
  UPLOAD_NOT_AUTHORIZED: 'Upload não autorizado para esse conjunto.',
  CATALOG_NOT_FOUND: 'Exercício não encontrado ou inativo.',
  RATE_LIMITED: 'Muitas alocações seguidas. Aguarde um pouco e tente de novo.',
  COPY_FAILED: 'Falha ao copiar as imagens para o armazenamento público. Tente publicar novamente.',
  MISSING_FILES: 'Selecione as duas imagens (posição inicial e final).',
  MISSING_FILE: 'Um dos arquivos não chegou ao servidor. Envie as imagens novamente.',
  VISUAL_VERSION_PROTECTED: 'Versões publicadas ou já usadas em publicação são protegidas.',
  VISUAL_FILE_REFERENCED:
    'Esta versão tem arquivos em uso. A exclusão foi bloqueada; nenhuma referência será removida.',
  VISUAL_ASSET_PATH_INVALID: 'Referências de arquivo inesperadas. A exclusão foi bloqueada.',
  VISUAL_SET_DELETED: 'Esta versão foi descartada. Faça um novo envio.',
  DELETION_PENDING:
    'A versão saiu da revisão; a remoção física dos arquivos está pendente. Reprocesse a exclusão.',
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

// Erros que o servidor dá de forma definitiva: repetir o mesmo envio (mesma chave) não adianta, o próximo
// precisa de uma nova alocação. Qualquer outro erro (rede, timeout, 5xx) pode ser repetido com a MESMA chave sem
// criar um segundo conjunto.
const DEFINITIVE_UPLOAD_ERRORS = new Set([
  'INVALID_IMAGE',
  'IMAGE_METADATA_NOT_ALLOWED',
  'UPLOAD_NOT_AUTHORIZED',
  'IDEMPOTENCY_KEY_REUSED',
  'INVALID_STATE',
  'VISUAL_SET_DELETED',
  'INCOMPLETE_VISUAL_SET',
  'IMAGE_TOO_LARGE',
  'MISSING_FILES',
  'FORBIDDEN',
  'CATALOG_NOT_FOUND',
])
export function isDefinitiveUploadError(error) {
  return DEFINITIVE_UPLOAD_ERRORS.has(error?.code) || DEFINITIVE_UPLOAD_ERRORS.has(error?.message)
}

// Chave de idempotência da alocação (uma por envio). Se o navegador não tem crypto.randomUUID, a alocação
// segue sem chave (continua serializada no banco; só perde a proteção contra retry).
export function newUploadRequestId() {
  try {
    return globalThis.crypto?.randomUUID?.() || null
  } catch {
    return null
  }
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

// Só versões publicadas/em revisão são carregadas inicialmente. Histórico é solicitado ao abrir.
const signedPreviewCache = new Map()
onPageCacheClear(() => signedPreviewCache.clear())
export async function listVisualSets(catalogId, { history = false } = {}) {
  let query = supabase
    .from('exercise_visual_sets')
    .select(
      'id, catalog_id, version, status, generation_source, prompt_version, style_version, provider_hint, prompt_start_hash, prompt_end_hash, reference_style_version, drafts_purged_at, created_by, approved_by, metadata, created_at, submitted_at, approved_at, published_at, assets:exercise_visual_assets(role, storage_bucket, storage_path, mime_type, width, height, byte_size, perceptual_hash)'
    )
    .eq('catalog_id', catalogId)
    .order('version', { ascending: false })
  if (!history) query = query.in('status', ['published', 'review'])
  const { data, error } = await query
  if (error) throw error
  const sets = data || []
  const now = Date.now()
  const drafts = [
    ...new Set(
      sets.flatMap((set) =>
        (set.assets || [])
          .filter(
            (asset) =>
              asset.storage_bucket === DRAFTS_BUCKET &&
              set.status !== 'allocated' &&
              !set.drafts_purged_at
          )
          .map((asset) => asset.storage_path)
      )
    ),
  ].filter((path) => (signedPreviewCache.get(path)?.until || 0) <= now)
  if (drafts.length) {
    const { data: urls, error: signError } = await supabase.storage
      .from(DRAFTS_BUCKET)
      .createSignedUrls(drafts, DRAFT_URL_TTL_SECONDS)
    if (!signError)
      drafts.forEach((path, index) => {
        if (urls?.[index]?.signedUrl)
          signedPreviewCache.set(path, {
            url: urls[index].signedUrl,
            until: now + (DRAFT_URL_TTL_SECONDS - 30) * 1000,
          })
      })
  }
  return sets.map((set) => ({
    ...set,
    previewUrls: Object.fromEntries(
      (set.assets || []).flatMap((asset) => {
        const url =
          asset.storage_bucket === PUBLIC_BUCKET
            ? publishedUrl(asset.storage_path)
            : set.status !== 'allocated' && !set.drafts_purged_at
              ? signedPreviewCache.get(asset.storage_path)?.url
              : null
        return url ? [[asset.role, url]] : []
      })
    ),
  }))
}

export async function listVisualDeletions(catalogId, { history = false } = {}) {
  let query = supabase
    .from('exercise_visual_deletions')
    .select('visual_set_id,version,status,last_error,created_at,completed_at')
    .eq('catalog_id', catalogId)
    .order('created_at', { ascending: false })
  query = history ? query.limit(50) : query.neq('status', 'complete')
  const { data, error } = await query
  if (error) throw error
  return data || []
}

// Request transaction removes the version from review. Only Storage-confirmed completion is reported.
export async function deleteVisualSet(visualSetId) {
  const { data, error } = await supabase.rpc('request_exercise_visual_deletion', {
    p_set_id: visualSetId,
  })
  if (error) throw error
  if (data?.status === 'complete') return { complete: true, status: 'complete' }
  try {
    return await callAdminFunction('delete-exercise-visual', { visualSetId })
  } catch {
    return { complete: false, status: 'pending' }
  }
}
export function retryVisualDeletion(visualSetId) {
  return callAdminFunction('delete-exercise-visual', { visualSetId })
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

// Storage devolve 409/"already exists" quando o arquivo daquele path já subiu (retry depois de uma falha
// parcial): o servidor revalida tudo no confirm, então isso não é erro.
function isAlreadyUploaded(error) {
  return (
    String(error?.statusCode) === '409' || /already exists|Duplicate/i.test(error?.message || '')
  )
}

// start/end viram WebP de até 1024px; a miniatura (320px) sai da posição inicial. Tudo é convertido no
// navegador (imageCompression rejeita bytes que não decodificam como imagem) e o servidor valida de
// novo no confirm. start e end são obrigatórios; a miniatura é melhor-esforço: se não puder ser gerada
// ou enviada, o conjunto segue só com start/end (o servidor aceita) em vez de falhar o envio inteiro.
//
// V2: `requestId` torna a alocação idempotente (duplo clique/retry/conexão instável devolvem o MESMO conjunto
// em vez de criar outro); `styleProfileId`, `promptStartHash`, `promptEndHash` e `providerHint` registram de
// onde veio a imagem (nunca segredo); o dHash de start/end gera só um AVISO no servidor. Devolve o conjunto já
// em `review`.
export async function uploadVisualSet({
  catalogId,
  startFile,
  endFile,
  generationSource = 'manual_upload',
  promptVersion = null,
  metadata = {},
  requestId = null,
  styleProfileId = null,
  promptStartHash = null,
  promptEndHash = null,
  providerHint = null,
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
  // Aviso de "imagens quase idênticas": melhor esforço, nunca atrapalha o envio.
  const [startHash, endHash] = await Promise.all([
    perceptualHashOfBlob(start).catch(() => null),
    perceptualHashOfBlob(end).catch(() => null),
  ])
  const perceptualHashes = {
    ...(startHash ? { start: startHash } : {}),
    ...(endHash ? { end: endHash } : {}),
  }

  const { data: allocation, error: allocateErr } = await supabase.rpc(
    'allocate_exercise_visual_set',
    {
      p_catalog_id: catalogId,
      p_generation_source: generationSource,
      p_prompt_version: promptVersion,
      p_metadata: metadata,
      p_request_id: requestId,
      p_style_profile_id: styleProfileId,
      p_prompt_start_hash: promptStartHash,
      p_prompt_end_hash: promptEndHash,
      p_provider_hint: providerHint,
    }
  )
  if (allocateErr) throw allocateErr

  const upload = (role, blob) =>
    supabase.storage.from(DRAFTS_BUCKET).upload(allocation.assets[role].path, blob, {
      contentType: 'image/webp',
      upsert: false,
    })
  // Repetição de um envio que já passou do upload (a resposta da confirmação se perdeu): o conjunto não está
  // mais `allocated`, os bytes já estão no servidor e só falta (re)confirmar -- a confirmação é idempotente.
  if (allocation.status === undefined || allocation.status === 'allocated') {
    for (const [role, blob] of [
      ['start', start],
      ['end', end],
    ]) {
      const { error: uploadErr } = await upload(role, blob)
      if (uploadErr && !isAlreadyUploaded(uploadErr)) throw uploadErr
    }
    if (thumbnail) {
      const { error: thumbErr } = await upload('thumbnail', thumbnail)
      if (thumbErr && !isAlreadyUploaded(thumbErr))
        console.warn('[exerciseVisualsService] miniatura não enviada, seguindo sem ela:', thumbErr)
    }
  }

  return callAdminFunction('exercise-visual-confirm', {
    visualSetId: allocation.visualSetId,
    ...(Object.keys(perceptualHashes).length ? { perceptualHashes } : {}),
  })
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
