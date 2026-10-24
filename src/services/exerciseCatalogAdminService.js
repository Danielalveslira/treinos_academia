import { supabase } from '../supabase/config'

// Administração do CONTEÚDO do catálogo oficial de exercícios (nome, músculos, categoria,
// instruções, ciclo de vida draft/in_review/published/withdrawn) -- só superadmin, aplicado no
// servidor (ver supabase/migrations/20261117000001_exercise_catalog_lifecycle.sql). Distinto de
// exerciseVisualsService.js, que administra só a MÍDIA (START/END); os dois painéis são
// compostos juntos em AdminExerciseCatalog.jsx, cada um com seu próprio estado.
export const PAGE_SIZE = 20

const ERROR_MESSAGES = {
  NOT_AUTHENTICATED: 'Sua sessão expirou. Faça login novamente.',
  SESSION_REVOKED: 'Sua sessão foi encerrada em outro dispositivo. Faça login novamente.',
  FORBIDDEN: 'Apenas superadmin pode gerenciar o catálogo de exercícios.',
  INVALID_ARGUMENT: 'Dados inválidos. Revise os campos e tente de novo.',
  CATALOG_NOT_FOUND: 'Exercício não encontrado.',
  INVALID_STATE: 'Esse exercício não está mais no estado esperado. Atualize a lista e tente de novo.',
  INCOMPLETE_CONTENT: 'Preencha músculo, categoria e pelo menos uma instrução antes de publicar.',
  INCOMPLETE_VISUAL_SET: 'As imagens de início e fim precisam estar publicadas antes de publicar o exercício.',
  REASON_REQUIRED: 'Informe o motivo da retirada.',
}

export function describeCatalogAdminError(error) {
  return (
    ERROR_MESSAGES[error?.message] ||
    ERROR_MESSAGES[error?.code] ||
    'Não foi possível concluir a operação. Tente novamente.'
  )
}

export async function listCatalogExercises({
  status = null,
  search = null,
  muscle = null,
  limit = PAGE_SIZE,
  offset = 0,
  onlyMissingImages = false,
} = {}) {
  const { data, error } = await supabase.rpc('admin_list_catalog_exercises', {
    p_status: status,
    p_search: search || null,
    p_muscle: muscle || null,
    p_limit: limit,
    p_offset: offset,
    p_only_missing_images: onlyMissingImages,
  })
  if (error) throw error
  const rows = data || []
  return { data: rows, total: rows[0]?.total_count ?? 0 }
}

export async function createCatalogDraft(fields) {
  const { data, error } = await supabase.rpc('admin_create_catalog_exercise_draft', {
    p_name: fields.name,
    p_primary_muscle: fields.primaryMuscle || null,
    p_muscles: fields.muscles?.length ? fields.muscles : null,
    p_equipment: fields.equipment || null,
    p_category: fields.category || null,
    p_difficulty: fields.difficulty || null,
    p_force: fields.force || null,
    p_mechanic: fields.mechanic || null,
    p_instructions: fields.instructions?.length ? fields.instructions : null,
    p_safety_notes: fields.safetyNotes?.length ? fields.safetyNotes : null,
  })
  if (error) throw error
  return data
}

export async function updateCatalogContent(id, fields) {
  const { data, error } = await supabase.rpc('admin_update_catalog_exercise_content', {
    p_id: id,
    p_name: fields.name,
    p_primary_muscle: fields.primaryMuscle || null,
    p_muscles: fields.muscles?.length ? fields.muscles : null,
    p_equipment: fields.equipment || null,
    p_category: fields.category || null,
    p_difficulty: fields.difficulty || null,
    p_force: fields.force || null,
    p_mechanic: fields.mechanic || null,
    p_instructions: fields.instructions?.length ? fields.instructions : null,
    p_safety_notes: fields.safetyNotes?.length ? fields.safetyNotes : null,
  })
  if (error) throw error
  return data
}

export async function submitCatalogForReview(id) {
  const { data, error } = await supabase.rpc('admin_submit_catalog_exercise_for_review', { p_id: id })
  if (error) throw error
  return data
}

export async function publishCatalogExercise(id) {
  const { data, error } = await supabase.rpc('admin_publish_catalog_exercise', { p_id: id })
  if (error) throw error
  return data
}

// p_reason é obrigatório no servidor (REASON_REQUIRED se vazio) -- a UI também exige antes de habilitar o botão.
export async function withdrawCatalogExercise(id, reason) {
  const { data, error } = await supabase.rpc('admin_withdraw_catalog_exercise', { p_id: id, p_reason: reason })
  if (error) throw error
  return data
}

export async function restoreCatalogExercise(id) {
  const { data, error } = await supabase.rpc('admin_restore_catalog_exercise', { p_id: id })
  if (error) throw error
  return data
}

export async function listCatalogAuditLog({ catalogId = null, action = null, limit = 50 } = {}) {
  const { data, error } = await supabase.rpc('admin_list_catalog_audit_log', {
    p_catalog_id: catalogId,
    p_action_filter: action,
    p_limit: limit,
  })
  if (error) throw error
  return data || []
}
