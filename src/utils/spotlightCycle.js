// Ordem do rodízio do card "Em destaque": a cada ciclo todos os destaques elegíveis aparecem UMA vez, em ordem
// aleatória, antes de qualquer repetição; ao acabar o ciclo embaralha de novo e o 1º do novo ciclo nunca é o
// último do anterior (quando há mais de um). Funções puras: o sorteio entra por `random` (testável).
// Estado: { order: string[] (ids do ciclo atual), index: number (posição atual), lastId: string | null }.

// Fisher-Yates sobre uma cópia.
export function shuffle(ids, random = Math.random) {
  const list = [...ids]
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

export function startCycle(ids, lastId = null, random = Math.random) {
  let order = shuffle(ids, random)
  // O último do ciclo anterior não abre o próximo (só faz sentido com mais de um).
  if (order.length > 1 && order[0] === lastId) {
    const swapWith = 1 + Math.floor(random() * (order.length - 1))
    ;[order[0], order[swapWith]] = [order[swapWith], order[0]]
  }
  return { order, index: 0, lastId: order.length ? order[order.length - 1] : lastId }
}

export function currentId(state) {
  return state ? (state.order[state.index] ?? null) : null
}

// Ajusta o ciclo em andamento ao conjunto de elegíveis de agora: quem ficou inelegível sai na hora (sem pular
// ninguém), quem chegou entra num ponto aleatório do que ainda falta mostrar neste ciclo. Devolve o MESMO objeto
// quando nada mudou (evita renderização à toa).
export function reconcile(state, eligibleIds, random = Math.random) {
  if (!state) return startCycle(eligibleIds, null, random)
  const eligible = new Set(eligibleIds)
  const inCycle = new Set(state.order)
  const added = eligibleIds.filter((id) => !inCycle.has(id))
  const unchanged = added.length === 0 && state.order.every((id) => eligible.has(id))
  if (unchanged) return state

  const keptBefore = state.order.slice(0, state.index).filter((id) => eligible.has(id))
  const upcoming = state.order.slice(state.index).filter((id) => eligible.has(id))
  for (const id of added) upcoming.splice(Math.floor(random() * (upcoming.length + 1)), 0, id)
  const order = [...keptBefore, ...upcoming]
  if (order.length === 0) return { order: [], index: 0, lastId: state.lastId }
  // keptBefore.length aponta para o destaque atual (se ainda elegível) ou para o seguinte (se saiu).
  return { order, index: keptBefore.length, lastId: state.lastId }
}

// Avança uma posição; no fim do ciclo, embaralha de novo (sem repetir o último como primeiro).
export function advance(state, eligibleIds, random = Math.random) {
  const synced = reconcile(state, eligibleIds, random)
  if (synced.order.length === 0) return synced
  const next = synced.index + 1
  if (next < synced.order.length) return { ...synced, index: next }
  return startCycle(eligibleIds, synced.order[synced.order.length - 1], random)
}
