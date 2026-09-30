import { supabase } from '../supabase/config'
import { getExerciseType } from '../utils/exerciseType'

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
  }
}

export async function listExercises(userId) {
  const { data, error } = await supabase
    .from('exercises')
    .select('*')
    .eq('user_id', userId)
    .order('name')
    .limit(MAX_EXERCISES)
  if (error) throw error
  return data.map(toDoc)
}

export async function createExercise(userId, exercise) {
  const { data, error } = await supabase
    .from('exercises')
    .insert({
      user_id: userId,
      name: exercise.name.trim(),
      muscle_group: exercise.muscleGroup.trim(),
      type: getExerciseType(exercise),
      note: exercise.note?.trim() || '',
      active: true,
      source: 'custom',
      provider: null,
      provider_exercise_id: null,
    })
    .select()
    .single()
  if (error) throw error
  return { id: data.id }
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
    })
    .select()
    .single()
  if (error) throw error
  return data.id
}

export async function updateExercise(userId, exerciseId, exercise, { clearOrder = false } = {}) {
  const patch = {
    name: exercise.name.trim(),
    muscle_group: exercise.muscleGroup.trim(),
    // type nunca muda depois de criado (ver ExerciseForm.jsx — o campo vira somente
    // leitura ao editar); reenviado aqui só pra "curar" exercícios antigos sem o campo
    // com um valor explícito na próxima edição, sem exigir uma migração em massa.
    type: getExerciseType(exercise),
    note: exercise.note?.trim() || '',
    active: exercise.active,
  }
  // A posição salva em "Reordenar exercícios" só faz sentido dentro do grupo em que foi
  // definida — ao trocar o exercício de grupo, ela precisa ser removida, não só deixada
  // desatualizada, senão o exercício herda uma posição arbitrária do grupo anterior.
  if (clearOrder) patch.order = null
  const { error } = await supabase.from('exercises').update(patch).eq('id', exerciseId).eq('user_id', userId)
  if (error) throw error
}

export async function deleteExercise(userId, exerciseId) {
  const { error } = await supabase.from('exercises').delete().eq('id', exerciseId).eq('user_id', userId)
  if (error) throw error
}

// Grava a nova ordem de um único grupo muscular num único statement atômico (RPC) —
// nunca uma reordenação parcial se algo falhar no meio.
export async function saveExerciseOrder(userId, orderedExerciseIds) {
  const { error } = await supabase.rpc('save_exercise_order', { p_exercise_ids: orderedExerciseIds })
  if (error) throw error
}
