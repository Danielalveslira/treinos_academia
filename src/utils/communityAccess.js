// Regras puras do acesso à área interna de uma comunidade. A DECISÃO é do servidor
// (RPC get_community_access); aqui só se traduz o estado devolvido em tela e em limpeza de cache.
// Resposta desconhecida nega (fail-closed).

export const COMMUNITY_ACCESS_STATES = ['member', 'not_member', 'banned', 'unavailable']

export function normalizeCommunityAccess(value) {
  return COMMUNITY_ACCESS_STATES.includes(value) ? value : 'unavailable'
}

// O que a tela mostra no lugar do feed: 'feed' (membro), 'join' (público, com "Entrar"),
// 'banned' e 'unavailable' (bloqueios, sem "Entrar").
export function communityAccessView(access) {
  const state = normalizeCommunityAccess(access)
  if (state === 'member') return 'feed'
  if (state === 'not_member') return 'join'
  return state
}

// Só limpa conteúdo quando se PERDE o acesso (era membro e deixou de ser). Revalidar um
// não-membro a cada abertura não pode derrubar as caches de lista à toa.
export function shouldPurgeCommunityState(previous, next) {
  return (
    normalizeCommunityAccess(previous) === 'member' && normalizeCommunityAccess(next) !== 'member'
  )
}

// Prefixos de cache em memória que guardam conteúdo interno de UMA comunidade para esta conta.
// `communities:{uid}` já cobre a página, os destaques e a lista "Minhas comunidades".
export function communityContentCachePrefixes(uid, communityId) {
  return [
    `communityFeed:${uid}:${communityId}`,
    `sponsoredAds:${communityId}`,
    `communities:${uid}`,
  ]
}

// Banir/remover tira o vínculo; o dono precisa continuar vendo quem está banido (para desbanir),
// então a lista da moderação é membros + restritos que já não são membros. Quem foi apenas
// removido (sem ban) e quem foi desbanido somem da lista.
export function mergeMembersWithBanned(members, restrictions) {
  const memberIds = new Set(members.map((member) => member.userId))
  const bannedOnly = restrictions
    .filter((restriction) => !memberIds.has(restriction.userId))
    .map((restriction) => ({
      id: restriction.id,
      communityId: restriction.communityId,
      userId: restriction.userId,
      joinedAt: null,
    }))
  return [...members, ...bannedOnly]
}
