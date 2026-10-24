import { supabase } from '../../supabase/config'
import { normalizeSheet, sheetFingerprint } from './workoutSheetValidation.js'

async function rpc(name, args) {
  if (globalThis.navigator?.onLine === false) throw new Error('SHEET_NETWORK_REQUIRED')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}
export const listWorkoutSheets = (archived = false, page = 0) =>
  rpc('list_my_workout_sheets', { p_archived: archived, p_offset: page * 40 })
export const getWorkoutSheet = (id, execution = false) =>
  rpc('get_my_workout_sheet', { p_sheet_id: id, p_for_execution: execution })
export const duplicateWorkoutSheet = (id, requestId) =>
  rpc('duplicate_workout_sheet', { p_source_id: id, p_request_id: requestId })
export const archiveWorkoutSheet = (sheet, archived) =>
  rpc('set_workout_sheet_archived', {
    p_sheet_id: sheet.id,
    p_archived: archived,
    p_expected_revision: sheet.revision,
  })
export const reorderWorkoutSheets = (ids) => rpc('reorder_workout_sheets', { p_ids: ids })
export async function saveWorkoutSheet(sheet, requestId) {
  const { items, ...metadata } = normalizeSheet(sheet)
  if (!sheet.id)
    return rpc('create_workout_sheet', {
      p_request_id: requestId,
      p_name: metadata.name,
      p_goal: metadata.goal,
      p_description: metadata.goal_description,
      p_weekdays: metadata.weekdays,
      p_items: items,
    })
  try {
    return await rpc('save_workout_sheet', {
      p_sheet_id: sheet.id,
      p_expected_revision: sheet.revision,
      p_metadata: metadata,
      p_items: items,
    })
  } catch (error) {
    // An ACK can be lost after commit. Never blindly replay a save against a new revision.
    if (!String(error.message).includes('SHEET_')) {
      try {
        const confirmed = await getWorkoutSheet(sheet.id)
        if (sheetFingerprint(confirmed) === sheetFingerprint(sheet))
          return { id: confirmed.id, revision: confirmed.revision }
      } catch {
        /* Preserve the original error and the local editor. */
      }
    }
    throw error
  }
}
const messages = {
  SHEET_VERSION_CONFLICT:
    'Esta ficha foi alterada em outra aba. Sua edição foi mantida. Compare com a versão atual antes de salvar.',
  SHEET_NOT_FOUND: 'Ficha indisponível ou sem permissão de acesso.',
  SHEET_NOT_READY:
    'A ficha está arquivada, vazia ou contém exercícios indisponíveis. Edite ou restaure antes de iniciar.',
  SHEET_EXERCISE_UNAVAILABLE:
    'Um exercício está indisponível. Remova-o ou substitua-o por um oficial publicado.',
  SHEET_LIMIT_REACHED: 'Limite de 40 fichas ativas atingido. Arquive uma ficha antes de continuar.',
  SHEET_NETWORK_REQUIRED:
    'Conecte-se à internet para acessar e salvar fichas. Sua edição permanece nesta tela.',
  SESSION_REVOKED: 'Sua sessão foi encerrada. Entre novamente.',
  APP_ACCESS_DENIED: 'Acesso à aplicação indisponível.',
}
export function sheetError(error) {
  return (
    Object.entries(messages).find(([key]) => String(error?.message).includes(key))?.[1] ||
    'Não foi possível concluir. Sua edição foi mantida; verifique a conexão e tente novamente.'
  )
}
