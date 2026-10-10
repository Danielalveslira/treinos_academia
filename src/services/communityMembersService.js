import { supabase } from '../supabase/config'
import { invalidateCommunitiesCache } from '../utils/pageCache'
import { normalizeJoinResult } from '../utils/communityAccess'

// Teto de defesa para a listagem de membros (moderação).
const MAX_MEMBERSHIPS = 200

function toDoc(row) {
  return {
    id: `${row.community_id}_${row.user_id}`,
    communityId: row.community_id,
    userId: row.user_id,
    joinedAt: row.joined_at,
  }
}

// Estado de acesso do usuário a TODAS as comunidades onde é membro ou está banido, numa única chamada
// (RPC list_my_community_access): a listagem nunca consulta o estado comunidade por comunidade.
// Retorna { [communityId]: 'member' | 'banned' }; comunidade ausente = 'not_member'.
export async function listMyCommunityAccess() {
  const { data, error } = await supabase.rpc('list_my_community_access')
  if (error) throw error
  const accessById = {}
  for (const row of data || []) {
    if (row.access === 'banned' || row.access === 'member')
      accessById[row.community_id] = row.access
  }
  return accessById
}

// Estado de acesso calculado pelo servidor (get_community_access): 'member' | 'not_member' |
// 'banned' | 'unavailable'. É a única fonte para abrir a área interna da comunidade -- o cliente
// nunca deduz "sou membro" de uma linha de community_members, porque remoção/banimento é uma
// decisão do servidor. Qualquer resposta desconhecida cai em 'unavailable' (fail-closed).
const COMMUNITY_ACCESS_STATES = ['member', 'not_member', 'banned', 'unavailable']

export async function getCommunityAccess(communityId) {
  const { data, error } = await supabase.rpc('get_community_access', {
    p_community_id: communityId,
  })
  if (error) throw error
  return COMMUNITY_ACCESS_STATES.includes(data) ? data : 'unavailable'
}

// Chamado tanto por useCommunities.js (lista) quanto por CommunityDetail.jsx (tela da comunidade).
// O servidor decide e devolve um estado ('joined' | 'already_member' | 'banned' | 'unavailable'); banido e
// indisponível NÃO são exceções. Falhas reais (rede, erro inesperado) continuam sendo lançadas. A cache da
// lista é invalidada em qualquer resultado definitivo, para a próxima leitura refletir o servidor.
export async function joinCommunity(communityId, userId) {
  const { data, error } = await supabase.rpc('join_community', { p_community_id: communityId })
  if (error) throw error
  const result = normalizeJoinResult(data)
  if (result === null) throw new Error('join_community: resposta desconhecida')
  invalidateCommunitiesCache(userId)
  return result
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
