import { supabase } from '../supabase/config'
import { invalidateCommunitiesCache } from '../utils/pageCache'

// Teto de defesa: bem acima do número de comunidades que existem no app (ver
// MAX_COMMUNITIES em communitiesService.js), então nunca deveria cortar uso real.
const MAX_MEMBERSHIPS = 200

function toDoc(row) {
  return {
    id: `${row.community_id}_${row.user_id}`,
    communityId: row.community_id,
    userId: row.user_id,
    joinedAt: row.joined_at,
  }
}

export async function listMyCommunityIds(userId) {
  const { data, error } = await supabase
    .from('community_members')
    .select('community_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false })
    .limit(MAX_MEMBERSHIPS)
  if (error) throw error
  return data.map((row) => row.community_id)
}

export async function isMember(communityId, userId) {
  const { data, error } = await supabase
    .from('community_members')
    .select('community_id')
    .eq('community_id', communityId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return !!data
}

// Chamado tanto por useCommunities.js (lista) quanto por CommunityDetail.jsx (tela da
// comunidade) — invalidar a cache da lista aqui, num único lugar, cobre os dois
// caminhos sem duplicar a chamada em cada componente.
export async function joinCommunity(communityId, userId) {
  const { error } = await supabase
    .from('community_members')
    .insert({ community_id: communityId, user_id: userId })
  if (error) throw error
  invalidateCommunitiesCache(userId)
}

export async function leaveCommunity(communityId, userId) {
  const { error } = await supabase
    .from('community_members')
    .delete()
    .eq('community_id', communityId)
    .eq('user_id', userId)
  if (error) throw error
  invalidateCommunitiesCache(userId)
}

export async function countMembers(communityId) {
  const { count, error } = await supabase
    .from('community_members')
    .select('*', { count: 'exact', head: true })
    .eq('community_id', communityId)
  if (error) throw error
  return count
}

// Fase 5: só quem as policies já deixam listar todos os membros de uma comunidade
// consegue algo além do próprio vínculo (superadmin, ou o dono dela). Usado pela seção
// "Gerenciar comunidade" para moderar membros/banimentos.
export async function listCommunityMembers(communityId) {
  const { data, error } = await supabase
    .from('community_members')
    .select('*')
    .eq('community_id', communityId)
    .limit(MAX_MEMBERSHIPS)
  if (error) throw error
  return data.map(toDoc)
}
