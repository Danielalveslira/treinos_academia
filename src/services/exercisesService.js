import { supabase } from '../supabase/config'
import { readThrough } from './offline/readThrough.js'
import {
  patchCachedUserExercise,
  readCachedUserExercises,
  removeCachedUserExercise,
  replaceCachedUserExercises,
  setCachedUserExerciseOrder,
  upsertCachedUserExercise,
} from './offline/userExercisesCache.js'

// Teto de defesa: ninguém cadastra centenas de exercícios de verdade, mas sem isso a
// leitura escala com o tamanho da tabela — o app já funciona bem dentro desse limite.
const MAX_EXERCISES = 300
const CATALOG_BATCH_SIZE = 40
const EXERCISE_COLUMNS =
  '*, catalog:exercise_catalog!exercises_catalog_id_fkey(id, provider, provider_exercise_id, status, name, primary_muscle, equipment, category)'
const officialProvider = (provider) => ['evolutus_dataset', 'evolutus_original'].includes(provider)
const referenceKey = (row) => JSON.stringify([row.provider, row.provider_exercise_id])

function matchesPublishedCatalog(row, catalog) {
  return Boolean(
    catalog?.status === 'published' &&
    catalog.id &&
    officialProvider(row.provider) &&
    typeof row.provider_exercise_id === 'string' &&
    row.provider_exercise_id.trim() &&
    catalog.provider === row.provider &&
    catalog.provider_exercise_id === row.provider_exercise_id &&
    (!row.catalog_id || row.catalog_id === catalog.id)
  )
}

// Older links may have only provider + external id. Resolve them in bounded batches,
// not per exercise; persist the result with the same private cache used by the list.
async function resolveLegacyCatalog(rows) {
  const references = [
    ...new Map(
      rows
        .filter(
          (row) =>
            row.source === 'catalog' &&
            !row.catalog_id &&
            officialProvider(row.provider) &&
            typeof row.provider_exercise_id === 'string' &&
            row.provider_exercise_id.trim()
        )
        .map((row) => [referenceKey(row), row])
    ).values(),
  ]
  if (!references.length) return rows
  const resolved = new Map()
  for (let offset = 0; offset < references.length; offset += CATALOG_BATCH_SIZE) {
    const batch = references.slice(offset, offset + CATALOG_BATCH_SIZE)
    const { data, error } = await supabase
      .from('exercise_catalog')
      .select('id, provider, provider_exercise_id, status, name, primary_muscle, equipment, category')
      .in('provider', [...new Set(batch.map((row) => row.provider))])
      .in('provider_exercise_id', [...new Set(batch.map((row) => row.provider_exercise_id))])
      .eq('status', 'published')
      .limit(batch.length * 2)
    if (error) throw error
    for (const row of data || []) resolved.set(referenceKey(row), row)
  }
  return rows.map((row) =>
    row.source === 'catalog' && !row.catalog_id
      ? { ...row, catalog: resolved.get(referenceKey(row)) || null }
      : row
  )
}

function toDoc(row) {
  const synced = Object.hasOwn(row, 'catalog') ? matchesPublishedCatalog(row, row.catalog) : row.catalogAvailable
  // The personal row's own name/muscle_group/equipment are a snapshot taken when the exercise
  // was added, never touched again -- an official catalog update must not need remove+re-add to
  // show here. Only override while the reference still resolves to a published catalog row;
  // otherwise this exercise is custom or its catalog link is gone, and the stored snapshot is
  // the only truth left, exactly as before this field existed.
  const official = synced ? row.catalog : null
  return {
    id: row.id,
    name: official?.name ?? row.name,
    muscleGroup: official?.primary_muscle ?? row.muscle_group,
    type: official ? (official.category === 'cardio' ? 'cardio' : 'strength') : row.type,
    note: row.note,
    active: row.active,
    source: row.source,
    provider: row.provider,
    providerExerciseId: row.provider_exercise_id,
    catalogId: row.catalog_id,
    equipment: official ? official.equipment ?? null : row.equipment,
    order: row.order,
    catalogAvailable: synced,
  }
}

// Lista pessoal (dado privado): o servidor manda; a resposta substitui a cópia local do usuário
// (services/offline/userExercisesCache.js), lida de volta só se a rede falhar.
export function listExercises(userId, { localOnly = false } = {}) {
  let rows = []
  return readThrough({
    label: 'exercises-list',
    localOnly,
    remote: async () => {
      const { data, error } = await supabase
        .from('exercises')
        .select(EXERCISE_COLUMNS)
        .eq('user_id', userId)
        .order('name')
        .limit(MAX_EXERCISES)
      if (error) throw error
      rows = await resolveLegacyCatalog(data)
      return rows.map(toDoc)
    },
    persist: () => replaceCachedUserExercises(userId, rows),
    local: async () => {
      const cached = await readCachedUserExercises(userId)
      return cached && cached.map(toDoc).sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}

// id NUNCA é derivado do ID do provedor (era o bug: 'catalog--<id-externo>' não é um
// uuid válido, exercises.id é uuid gerado pelo Postgres) -- o vínculo com o catálogo
// vive em provider/provider_exercise_id (snapshot resiliente) + catalog_id (atalho
// opcional, nunca a chave primária).
export async function createCatalogExercise(userId, exercise) {
  const { data, error } = await supabase
    .from('exercises')
    .insert({
      user_id: userId,
      name: exercise.name,
      muscle_group: exercise.muscleGroup,
      type: exercise.type || 'strength',
      note: exercise.note || '',
      active: exercise.active ?? true,
      source: 'catalog',
      provider: exercise.provider,
      provider_exercise_id: exercise.providerExerciseId,
      catalog_id: exercise.catalogId || null,
      equipment: exercise.equipment || null,
      order: Number.isInteger(exercise.order) ? exercise.order : null,
    })
    .select(EXERCISE_COLUMNS)
    .single()
  if (error?.code === '23505') {
    const { data: existing, error: readError } = await supabase
      .from('exercises')
      .select(EXERCISE_COLUMNS)
      .eq('user_id', userId)
      .eq('source', 'catalog')
      .eq('provider', exercise.provider)
      .eq('provider_exercise_id', exercise.providerExerciseId)
      .single()
    if (readError) throw readError
    const [confirmed] = await resolveLegacyCatalog([existing])
    upsertCachedUserExercise(userId, confirmed)
    return { added: false, exercise: toDoc(confirmed) }
  }
  if (error) throw error
  const [confirmed] = await resolveLegacyCatalog([data])
  upsertCachedUserExercise(userId, confirmed)
  return { added: true, exercise: toDoc(confirmed) }
}

// Only personal preferences are writable; official identity and snapshots never leave the client.
export async function updateExercise(userId, exerciseId, exercise) {
  const patch = {
    ...(Object.hasOwn(exercise, 'note') ? { note: exercise.note?.trim() || '' } : {}),
    ...(Object.hasOwn(exercise, 'active') ? { active: exercise.active } : {}),
  }
  if (!Object.keys(patch).length) return
  const { error } = await supabase
    .from('exercises')
    .update(patch)
    .eq('id', exerciseId)
    .eq('user_id', userId)
  if (error) throw error
  patchCachedUserExercise(userId, exerciseId, patch)
}

export async function deleteExercise(userId, exerciseId) {
  const { error } = await supabase
    .from('exercises')
    .delete()
    .eq('id', exerciseId)
    .eq('user_id', userId)
  if (error) throw error
  removeCachedUserExercise(userId, exerciseId)
}

// Grava a nova ordem de um único grupo muscular num único statement atômico (RPC) —
// nunca uma reordenação parcial se algo falhar no meio.
export async function saveExerciseOrder(userId, orderedExerciseIds) {
  const { error } = await supabase.rpc('save_exercise_order', {
    p_exercise_ids: orderedExerciseIds,
  })
  if (error) throw error
  setCachedUserExerciseOrder(userId, orderedExerciseIds)
}
