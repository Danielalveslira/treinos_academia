// Decide se a publicação alvo de um link (#treino-/#publicacao-) já está em alguma lista
// carregada da tela da comunidade; só quando não está é que se faz a leitura pontual por ID.
export function isStatusLoaded(statusId, ...lists) {
  return lists.some((list) => (list || []).some((status) => status?.id === statusId))
}
