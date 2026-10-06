import { supabase } from '../supabase/config'
import { readThrough } from './offline/readThrough.js'
import { isLocalFallback } from './offline/localFallback.js'
import {
  cacheCatalogEntries,
  cacheCatalogTaxonomy,
  readCachedCatalogEntry,
  readCachedCatalogTaxonomy,
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

function toPrimaryMuscles(row) {
  return row.primary_muscle ? [row.primary_muscle] : []
}

function toSecondaryMuscles(row) {
  return (row.muscles || []).filter((muscle) => muscle !== row.primary_muscle)
}

function mapRow(row) {
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
    images: row.media_refs?.images || [],
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

export function getExerciseDetail({ catalogId, provider, providerExerciseId }) {
  return readThrough({
    label: 'catalog-detail',
    remote: async () => {
      let query = supabase.from('exercise_catalog').select(
        'id, provider, provider_exercise_id, name, primary_muscle, muscles, equipment, category, difficulty, force, mechanic, instructions, media_refs'
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

function fetchCatalogTaxonomy() {
  return readThrough({
    label: 'catalog-taxonomy',
    remote: fetchRemoteTaxonomy,
    persist: cacheCatalogTaxonomy,
    local: readCachedCatalogTaxonomy,
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
