import { supabase } from '../supabase/config'
import { readThrough } from './offline/readThrough.js'
import { isLocalFallback } from './offline/localFallback.js'
import {
  cacheCatalogEntries,
  cacheCatalogTaxonomy,
  readCachedCatalogEntry,
  readCachedCatalogTaxonomy,
  readCatalogSnapshotTaxonomy,
  searchCachedCatalog,
} from './offline/exerciseCache.js'

// Catálogo agora é nosso (public.exercise_catalog, alimentado por
// scripts/import-exercise-catalog.mjs) -- consulta direta ao Postgres via RPC, sem
// proxy externo, sem cache local por dispositivo: não há mais custo/latência de API de
// terceiro a evitar, só uma tabela pequena (868 linhas) com os índices certos (ver
// migration 20260930000001_exercise_catalog.sql). Nunca carrega o catálogo inteiro --
// toda consulta é paginada.
//
// Offline (Fase 2): o servidor continua sendo a fonte; o que ele devolve é guardado no
// IndexedDB (services/offline/exerciseCache.js) em segundo plano e só é lido de volta quando a
// requisição falha por CONECTIVIDADE (nunca por auth/permissão). Não carrega o catálogo inteiro.
const PAGE_SIZE_DEFAULT = 20

// Mídia oficial dos exercícios (docs/promps/Evolutus_arquitetura_imagens_exercicios_V2_auditada.md):
// o banco guarda só o PATH do arquivo publicado (exercise_catalog.published_media_refs) e o cliente
// monta a URL pública do bucket -- getPublicUrl só concatena, não é uma leitura a mais. A mídia do
// dataset original (source_media_refs) NÃO é exibida: aqueles paths não existem em lugar nenhum.
export const EXERCISE_VISUALS_BUCKET = 'exercise-visuals'
// {catalogId}/v{versão}/{start|end|thumb}.webp -- qualquer outro formato é ignorado (nunca vira URL).
const PUBLISHED_PATH = /^[0-9a-f-]{36}\/v\d{1,6}\/(start|end|thumb)\.webp$/

function publicUrlFor(path) {
  if (typeof path !== 'string' || !PUBLISHED_PATH.test(path)) return null
  return supabase.storage.from(EXERCISE_VISUALS_BUCKET).getPublicUrl(path)?.data?.publicUrl || null
}

export function resolveExercisePublishedImages(publishedMediaRefs) {
  const byRole = new Map()
  for (const image of Array.isArray(publishedMediaRefs?.images) ? publishedMediaRefs.images : []) {
    if (typeof image?.path === 'string') byRole.set(image.role, image.path)
  }
  const urls = []
  for (const role of ['start', 'end']) {
    const url = publicUrlFor(byRole.get(role))
    if (url) urls.push(url)
  }
  return urls
}

// Miniatura opcional: ao contrário de start/end, private.apply_published_visual_set (migration
// exercise_visuals_v2.sql) NÃO guarda a thumbnail dentro de `images[]` -- ela é uma chave própria,
// `published_media_refs.thumbnail.path`, ausente quando o conjunto não tem miniatura (nunca um
// path nulo). Campo novo e independente de `images` (start/end), para não exigir reescrever o
// `slice(0, 2)`/`[0]` já usado em vários componentes.
export function resolveExercisePublishedThumbnail(publishedMediaRefs) {
  return publicUrlFor(publishedMediaRefs?.thumbnail?.path)
}

function toPrimaryMuscles(row) {
  return row.primary_muscle ? [row.primary_muscle] : []
}

function toSecondaryMuscles(row) {
  return (row.muscles || []).filter((muscle) => muscle !== row.primary_muscle)
}

export function mapRow(row) {
  return {
    id: row.id,
    providerExerciseId: row.provider_exercise_id,
    provider: row.provider,
    name: row.name,
    primaryMuscles: toPrimaryMuscles(row),
    secondaryMuscles: toSecondaryMuscles(row),
    equipment: row.equipment,
    category: row.category,
    level: row.difficulty,
    force: row.force,
    mechanic: row.mechanic,
    instructions: row.instructions || [],
    images: resolveExercisePublishedImages(row.published_media_refs),
    thumbnail: resolveExercisePublishedThumbnail(row.published_media_refs),
  }
}

export function searchExercises({
  q, category, muscle, equipment, level, limit = PAGE_SIZE_DEFAULT, offset = 0,
}) {
  return readThrough({
    label: 'catalog-search',
    remote: async () => {
      const { data, error } = await supabase.rpc('search_exercise_catalog', {
        p_query: q || null,
        p_category: category || null,
        p_equipment: equipment || null,
        p_muscle: muscle || null,
        p_difficulty: level || null,
        p_limit: limit,
        p_offset: offset,
      })
      if (error) throw error
      return {
        data: data.map(mapRow),
        total: data[0]?.total_count ?? 0,
      }
    },
    persist: (result) => cacheCatalogEntries(result.data),
    local: () => searchCachedCatalog({ q, category, muscle, equipment, level, limit, offset }),
  })
}

// Página de UM lote da sincronização completa offline (catalogSnapshot.js) -- keyset por `id`,
// não offset: pedir "o que vem depois do último id visto" é imune a linhas que mudam de posição
// entre chamadas (diferente da search_exercise_catalog, cuja ordenação sem termo de busca é só
// por nome e não é garantida estável entre duas chamadas separadas se houver nomes repetidos).
// RPC list_exercise_catalog_for_sync ainda não existe no Supabase remoto (migration local, não
// aplicada) -- erro 42883 (função inexistente) é tratado pelo chamador como "sem suporte ainda".
export async function fetchCatalogSyncPage({ afterId = null, limit = 50 } = {}) {
  const { data, error } = await supabase.rpc('list_exercise_catalog_for_sync', {
    p_after_id: afterId,
    p_limit: limit,
  })
  if (error) throw error
  return data.map(mapRow)
}

// Revisão barata do catálogo (trigger+RPC de migration local, não aplicada ainda) -- usada por
// catalogSnapshot.js para decidir se vale a pena baixar tudo de novo. Lança se a RPC não existir
// ou a rede falhar; o chamador decide o fallback (janela de tempo amortizada).
export async function fetchCatalogRevision() {
  const { data, error } = await supabase.rpc('get_exercise_catalog_revision')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { revision: row?.revision ?? null, totalActive: Number(row?.total_active) || 0 }
}

export function getExerciseDetail({ catalogId, provider, providerExerciseId }) {
  return readThrough({
    label: 'catalog-detail',
    remote: async () => {
      let query = supabase.from('exercise_catalog').select(
        'id, provider, provider_exercise_id, name, primary_muscle, muscles, equipment, category, difficulty, force, mechanic, instructions, published_media_refs'
      )
      query = catalogId
        ? query.eq('id', catalogId)
        : query.eq('provider', provider).eq('provider_exercise_id', providerExerciseId)

      const { data, error } = await query.maybeSingle()
      if (error) throw error
      return data ? mapRow(data) : null
    },
    // null = "não existe mais no catálogo" (resposta válida do servidor): nada a guardar.
    persist: (exercise) => (exercise ? cacheCatalogEntries([exercise]) : undefined),
    local: () => readCachedCatalogEntry({ catalogId, provider, providerExerciseId }),
  })
}

// Distinct de colunas pequenas (muscles[]/equipment/category/difficulty) sobre um
// catálogo de 868 linhas -- mais simples e barato que manter RPCs só pra isso. Vem sempre
// dos dados reais (nunca um enum hardcoded desalinhado do catálogo) e nunca inclui um
// filtro vazio (só valores realmente presentes). Cacheia a PROMISE (não só o resultado)
// pra dedupear chamadas concorrentes -- dois componentes montando ao mesmo tempo (ex.:
// ExerciseCatalog + algo mais) disparam uma única consulta, não duas.
let taxonomyPromise = null
async function fetchRemoteTaxonomy() {
  const { data, error } = await supabase
    .from('exercise_catalog')
    .select('muscles, equipment, category, difficulty')
    .eq('is_active', true)
  if (error) throw error
  const muscles = new Set()
  const equipment = new Set()
  const categories = new Set()
  const levels = new Set()
  for (const row of data) {
    for (const muscle of row.muscles || []) muscles.add(muscle)
    if (row.equipment) equipment.add(row.equipment)
    if (row.category) categories.add(row.category)
    if (row.difficulty) levels.add(row.difficulty)
  }
  return {
    muscles: [...muscles].sort(),
    equipment: [...equipment].sort(),
    categories: [...categories].sort(),
    levels: [...levels].sort(),
  }
}

// Snapshot completo (todos os exercícios ativos) é a fonte mais confiável de taxonomia offline;
// cacheCatalogTaxonomy (blob oportunista, pode ter sido gravado antes de o snapshot existir) é
// só o fallback para aparelhos que ainda não terminaram a primeira sincronização completa.
async function readLocalTaxonomy() {
  const fromSnapshot = await readCatalogSnapshotTaxonomy()
  return fromSnapshot ?? readCachedCatalogTaxonomy()
}

function fetchCatalogTaxonomy() {
  return readThrough({
    label: 'catalog-taxonomy',
    remote: fetchRemoteTaxonomy,
    persist: cacheCatalogTaxonomy,
    local: readLocalTaxonomy,
  }).catch((error) => {
    taxonomyPromise = null // erro não fica em cache -- próxima chamada tenta de novo
    throw error
  })
}

export function listCatalogTaxonomy() {
  if (!taxonomyPromise) {
    taxonomyPromise = fetchCatalogTaxonomy().then((taxonomy) => {
      // Dado vindo do aparelho (sem rede) não fica fixado na sessão: a próxima chamada tenta o servidor.
      if (isLocalFallback(taxonomy)) taxonomyPromise = null
      return taxonomy
    })
  }
  return taxonomyPromise
}
