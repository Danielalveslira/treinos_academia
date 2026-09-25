// Sobrevive exatamente a um redirecionamento (Auth -> "/login"), nunca mais que isso --
// sessionStorage (não localStorage) já garante que uma aba nova ou um login legítimo
// numa aba futura nunca reveja um aviso de uma sessão completamente diferente. Só usado
// para explicar POR QUE alguém foi desconectado sem ação própria (ver AuthContext.jsx,
// handlePossibleGhostSession) -- nunca para mensagens de sucesso/fluxo normal.
const KEY = 'evolutus:logout-reason'

const REASONS = {
  'account-deleted':
    'Sua conta não está mais disponível. Se isso for um engano, entre em contato pelo suporte.',
  // Distinto de 'account-deleted': aqui a exclusão está genuinamente em processamento
  // (state:'pending' em deletionJobs/account_{uid}, confirmado via getMyDeletionStatus),
  // não necessariamente concluída -- ver handlePossibleGhostSession em AuthContext.jsx.
  'account-deleting':
    'Sua conta está em processo de exclusão e a sessão foi encerrada. Se isso for um engano, entre em contato pelo suporte.',
}

export function setLogoutReason(reason) {
  try {
    sessionStorage.setItem(KEY, reason)
  } catch {
    // Storage indisponível (aba privada, política do navegador) -- o logout em si já
    // aconteceu de qualquer forma; só a mensagem explicativa é best-effort.
  }
}

// Lê E limpa numa única chamada -- a mensagem é para a PRÓXIMA renderização da tela de
// login, nunca para a seguinte (senão sobreviveria a um login bem-sucedido e reapareceria
// depois de um logout comum sem relação nenhuma).
export function consumeLogoutReason() {
  try {
    const reason = sessionStorage.getItem(KEY)
    if (!reason) return ''
    sessionStorage.removeItem(KEY)
    return REASONS[reason] || ''
  } catch {
    return ''
  }
}
