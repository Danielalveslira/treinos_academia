import { supabase } from '../supabase/config'

export async function listProgressDays(userId, startDateKey, endDateKey) {
  const { data, error } = await supabase.rpc('list_progress_days', {
    p_start: startDateKey,
    p_end: endDateKey,
  })
  if (error) throw error
  return data
}

export async function getProgressSheetSummary(startDateKey, endDateKey) {
  const { data, error } = await supabase.rpc('get_my_progress_sheet_summary', {
    p_start: startDateKey,
    p_end: endDateKey,
  })
  if (error) throw error
  return data
}
