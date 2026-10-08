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

// Nomes públicos (@usuário) de vários usuários de uma vez (public_profiles é legível por qualquer usuário
// autenticado), em lotes que mantêm a URL curta: 1 consulta a cada 40 usuários, nunca 1 por usuário.
// Quem não tem perfil público (ou username vazio) volta como null: a tela mostra "Membro", nunca o id.
const USERNAME_BATCH_SIZE = 40

export async function listPublicUsernames(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean)
  const usernames = Object.fromEntries(ids.map((id) => [id, null]))
  const requests = []
  for (let i = 0; i < ids.length; i += USERNAME_BATCH_SIZE) {
    const batch = ids.slice(i, i + USERNAME_BATCH_SIZE)
    requests.push(
      supabase
        .from('public_profiles')
        .select('user_id,username')
        .in('user_id', batch)
        .then(({ data, error }) => {
          if (error) throw error
          for (const row of data) usernames[row.user_id] = row.username || null
        })
    )
  }
  await Promise.all(requests)
  return usernames
}
