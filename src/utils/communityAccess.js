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

// ---------------------------------------------------------------------------
// Entrar na comunidade: o servidor (RPC join_community) devolve um ESTADO estável, nunca uma exceção para
// situações de autorização. Falhas reais (rede, erro inesperado) chegam como exceção e são classificadas aqui
// por tipo/código estruturado -- nunca por texto de mensagem do servidor.
// ---------------------------------------------------------------------------
export const JOIN_RESULTS = ['joined', 'already_member', 'banned', 'unavailable']

export function normalizeJoinResult(value) {
  return JOIN_RESULTS.includes(value) ? value : null
}

// Estado de acesso local resultante de um resultado de entrada (null = resultado desconhecido: não assume nada).
export function accessAfterJoin(result) {
  if (result === 'joined' || result === 'already_member') return 'member'
  if (result === 'banned') return 'banned'
  if (result === 'unavailable') return 'unavailable'
  return null
}

export const COMMUNITY_MESSAGES = {
  // Explorar / tentativa de entrada (aviso contextual compacto no cartão).
  joinBlockedTitle: 'Você não pode entrar nesta comunidade',
  joinBlockedText: 'Seu acesso a esta comunidade foi bloqueado pelos administradores.',
  blockedBadge: 'Acesso bloqueado',
  unavailableBadge: 'Indisponível',
  // Rota direta da comunidade.
  pageBlockedTitle: 'Acesso à comunidade bloqueado',
  pageBlockedText: 'Você não pode acessar o conteúdo desta comunidade.',
  unavailable: 'Esta comunidade não está disponível.',
  network: 'Não foi possível conectar. Verifique sua internet e tente novamente.',
  unexpected: 'Não foi possível entrar na comunidade. Tente novamente.',
}

// Mensagem para uma falha (exceção) ao entrar: 'network' ou 'unexpected'. Sem erro técnico bruto.
export function describeJoinFailure(kind) {
  return kind === 'connectivity' ? COMMUNITY_MESSAGES.network : COMMUNITY_MESSAGES.unexpected
}

// O que o cartão do Explorar oferece para o estado de acesso: botão de entrar, bloqueio desabilitado,
// indisponível desabilitado, ou nada (membro nunca recebe "Entrar").
export function exploreCardAction(access) {
  switch (normalizeCommunityAccess(access === undefined ? 'not_member' : access)) {
    case 'not_member':
      return 'join'
    case 'banned':
      return 'blocked'
    case 'member':
      return 'none'
    default:
      return 'unavailable'
  }
}

// Mapa { [communityId]: 'member' | 'banned' | 'unavailable' } com a mudança de uma comunidade aplicada (sem
// mutar o original). 'not_member' remove a entrada (ausente = not_member).
export function withCommunityAccess(accessById, communityId, access) {
  const next = { ...accessById }
  if (access === 'not_member') delete next[communityId]
  else next[communityId] = access
  return next
}

// Divide as comunidades para a tela: "Minhas" (membro) e "Explorar" (todo o resto, cada item já com `access`).
// Uma única passada sobre dados que vieram de UMA consulta: o estado de cada cartão nunca exige chamada extra.
export function splitCommunitiesByAccess(communities, accessById) {
  const mine = []
  const explore = []
  for (const community of communities) {
    const access = accessById[community.id]
    if (access === 'member') mine.push(community)
    else explore.push({ ...community, access: access ?? 'not_member' })
  }
  return { mine, explore }
}
