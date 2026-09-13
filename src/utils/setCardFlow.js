// Depois de remover a série ATIVA (botão "Remover série" em SetCard.jsx, sempre a
// exibida no momento -- nunca outra): se ela não era a última, a próxima sobe pra essa
// posição e o índice numérico continua correto sem mudar. Se era a última, não sobra
// mais nada nessa posição -- volta uma posição. Math.max(0, ...) cobre o caso trivial
// de restar só uma série (embora o botão já fique desabilitado antes disso acontecer).
export function nextActiveSetIndexAfterRemoval(activeIndex, previousLength) {
  const wasLast = activeIndex === previousLength - 1
  return wasLast ? Math.max(0, activeIndex - 1) : activeIndex
}
