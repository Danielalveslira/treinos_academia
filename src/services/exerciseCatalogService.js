import { supabase } from '../supabase/config'

// Catálogo agora é nosso (public.exercise_catalog, alimentado por
// scripts/import-exercise-catalog.mjs) -- consulta direta ao Postgres via RPC, sem
// proxy externo, sem cache local por dispositivo: não há mais custo/latência de API de
// terceiro a evitar, só uma tabela pequena (868 linhas) com os índices certos (ver
// migration 20260930000001_exercise_catalog.sql). Nunca carrega o catálogo inteiro --
// toda consulta é paginada.
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

export async function searchExercises({
  q, category, muscle, equipment, level, limit = PAGE_SIZE_DEFAULT, offset = 0,
}) {
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
}

export async function getExerciseDetail({ catalogId, provider, providerExerciseId }) {
  let query = supabase.from('exercise_catalog').select(
    'id, provider, provider_exercise_id, name, primary_muscle, muscles, equipment, category, difficulty, force, mechanic, instructions, media_refs'
  )
  query = catalogId
    ? query.eq('id', catalogId)
    : query.eq('provider', provider).eq('provider_exercise_id', providerExerciseId)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data ? mapRow(data) : null
}

// Distinct de duas colunas pequenas (muscles[]/equipment) sobre um catálogo de 868
// linhas -- mais simples e barato que manter uma segunda RPC só pra isso, e cacheável em
// memória pela sessão (não muda durante o uso do app).
let taxonomyCache = null
export async function listCatalogTaxonomy() {
  if (taxonomyCache) return taxonomyCache
  const { data, error } = await supabase.from('exercise_catalog').select('muscles, equipment').eq('is_active', true)
  if (error) throw error
  const muscles = new Set()
  const equipment = new Set()
  for (const row of data) {
    for (const muscle of row.muscles || []) muscles.add(muscle)
    if (row.equipment) equipment.add(row.equipment)
  }
  taxonomyCache = { muscles: [...muscles].sort(), equipment: [...equipment].sort() }
  return taxonomyCache
}
