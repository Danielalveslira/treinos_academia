// Espelha functions/economy/vote-core.js::economyVoteCountDelta -- mesma tabela de
// transição, do lado do cliente. Nunca é fonte de verdade: só roda DEPOIS da resposta
// de sucesso de voteOnPost (ver EconomyVoteBar.jsx), para refletir na tela algo que o
// backend já persistiu com atomicidade real. O backend nunca é alterado por isto.
export function economyVoteCountDelta(beforeValue, afterValue) {
  const before = beforeValue ?? null
  const after = afterValue ?? null
  let positiveDelta = 0
  let negativeDelta = 0
  if (before === after) return { positiveDelta, negativeDelta }
  if (before === 1) positiveDelta -= 1
  else if (before === -1) negativeDelta -= 1
  if (after === 1) positiveDelta += 1
  else if (after === -1) negativeDelta += 1
  return { positiveDelta, negativeDelta }
}

// Aplica o delta a UM status, sempre clampado em 0 -- nunca deveria acontecer com um
// delta correto (a contagem local só é usada com o valor real vindo do backend), mas é
// a rede de segurança contra qualquer drift entre o estado local e o real.
export function applyEconomyVoteCountDelta(status, { positiveDelta = 0, negativeDelta = 0 } = {}) {
  return {
    ...status,
    positiveVoteCount: Math.max(0, (status.positiveVoteCount ?? 0) + positiveDelta),
    negativeVoteCount: Math.max(0, (status.negativeVoteCount ?? 0) + negativeDelta),
  }
}

// Puro, sem I/O, sem setState: usado tanto por useCommunityFeed.js (statuses) quanto
// por CommunityDetail.jsx (featuredStatuses) -- o mesmo post pode aparecer nas duas
// listas ao mesmo tempo (ver Fase 6), e as duas precisam do mesmo tratamento. Nunca
// dispara um refetch (é só um .map() em memória); devolve a MESMA referência de array
// quando statusId não está na lista, pra nunca causar um re-render à toa.
export function applyEconomyVoteCountDeltaToList(list, statusId, delta) {
  let changed = false
  const next = list.map((status) => {
    if (status.id !== statusId) return status
    changed = true
    return applyEconomyVoteCountDelta(status, delta)
  })
  return changed ? next : list
}
