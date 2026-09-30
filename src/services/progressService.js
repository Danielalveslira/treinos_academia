import { supabase } from '../supabase/config'

export async function listProgressDays(userId, startDateKey, endDateKey) {
  const { data, error } = await supabase.rpc('list_progress_days', {
    p_start: startDateKey,
    p_end: endDateKey,
  })
  if (error) throw error
  return data
}
