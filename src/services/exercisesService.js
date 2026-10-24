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

function toDoc(row) {
  return {
    id: row.id,
    name: row.name,
    muscleGroup: row.muscle_group,
    type: row.type,
    note: row.note,
    active: row.active,
    source: row.source,
    provider: row.provider,
    providerExerciseId: row.provider_exercise_id,
    catalogId: row.catalog_id,
    equipment: row.equipment,
    order: row.order,
    catalogAvailable: Object.hasOwn(row, 'catalog')
      ? row.catalog?.status === 'published'
      : row.catalogAvailable,
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
        .select('*, catalog:exercise_catalog!exercises_catalog_id_fkey(status)')
        .eq('user_id', userId)
        .order('name')
        .limit(MAX_EXERCISES)
      if (error) throw error
      rows = data
      return data.map(toDoc)
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
    .select()
    .single()
  if (error?.code === '23505') {
    const { data: existing, error: readError } = await supabase
      .from('exercises')
      .select('*')
      .eq('user_id', userId)
      .eq('source', 'catalog')
      .eq('provider', exercise.provider)
      .eq('provider_exercise_id', exercise.providerExerciseId)
      .single()
    if (readError) throw readError
    upsertCachedUserExercise(userId, existing)
    return { added: false, exercise: toDoc({ ...existing, catalogAvailable: true }) }
  }
  if (error) throw error
  const confirmed = { ...data, catalogAvailable: true }
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
