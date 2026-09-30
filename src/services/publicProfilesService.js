import { supabase } from '../supabase/config'

export async function getPublicProfile(userId) {
  const { data, error } = await supabase
    .from('public_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.user_id,
    username: data.username,
    bio: data.bio,
    shareStatistics: data.share_statistics,
    avatarPath: data.avatar_path,
  }
}

export async function getPublicStatistics(userId) {
  const { data, error } = await supabase
    .from('public_profile_statistics')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data ? { entries: data.entries, sets: data.sets, updatedAt: data.updated_at } : null
}

// AUD-006: o cálculo (agregação sobre o diário real de treino) e a gravação do resumo
// público rodam no servidor via RPC security definer — o cliente não escreve mais esse
// registro direto. Sempre para o próprio usuário autenticado (a RPC usa auth.uid(),
// nunca aceita um userId arbitrário).
export async function refreshPublicStatistics() {
  const { error } = await supabase.rpc('refresh_public_statistics')
  if (error) throw error
}
