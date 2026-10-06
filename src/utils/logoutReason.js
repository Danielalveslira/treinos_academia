// Sobrevive exatamente a um redirecionamento (Auth -> "/login"), nunca mais que isso --
// sessionStorage (não localStorage) já garante que uma aba nova ou um login legítimo
// numa aba futura nunca reveja um aviso de uma sessão completamente diferente. Só usado
// para explicar POR QUE alguém foi desconectado sem ação própria (ver AuthContext.jsx,
// handlePossibleGhostSession) -- nunca para mensagens de sucesso/fluxo normal.
const KEY = 'evolutus:logout-reason'

const REASONS = {
  // Logout pedido pelo próprio usuário (ver useLogout): só confirma que a sessão foi encerrada.
  'signed-out': { message: 'Você saiu da conta.', tone: 'default' },
  // "Sair de todos os dispositivos" (logout global, com confirmação).
  'signed-out-all': { message: 'Você saiu da conta em todos os dispositivos.', tone: 'default' },
  // Voltou a rede depois de um período offline e a sessão não pôde ser renovada. Não é logout do usuário: o
  // que ele salvou neste aparelho continua guardado e sincroniza depois que ele entrar de novo.
  'session-expired': {
    message:
      'Sua sessão expirou. Entre novamente para sincronizar suas alterações; o que você salvou neste aparelho continua guardado.',
    tone: 'warning',
  },
  'account-deleted': {
    message:
      'Sua conta não está mais disponível. Se isso for um engano, entre em contato pelo suporte.',
    tone: 'warning',
  },
  // Distinto de 'account-deleted': aqui a exclusão está genuinamente em processamento
  // (state:'pending' em deletionJobs/account_{uid}, confirmado via getMyDeletionStatus),
  // não necessariamente concluída -- ver handlePossibleGhostSession em AuthContext.jsx.
  'account-deleting': {
    message:
      'Sua conta está em processo de exclusão e a sessão foi encerrada. Se isso for um engano, entre em contato pelo suporte.',
    tone: 'warning',
  },
}

export function setLogoutReason(reason) {
  try {
    sessionStorage.setItem(KEY, reason)
  } catch {
    // Storage indisponível (aba privada, política do navegador) -- o logout em si já
    // aconteceu de qualquer forma; só a mensagem explicativa é best-effort.
  }
}

// Devolve { message, tone } ou null. Lê E limpa numa única chamada -- a mensagem é para a PRÓXIMA renderização da tela de
// login, nunca para a seguinte (senão sobreviveria a um login bem-sucedido e reapareceria
// depois de um logout comum sem relação nenhuma).
export function consumeLogoutReason() {
  try {
    const reason = sessionStorage.getItem(KEY)
    if (!reason) return null
    sessionStorage.removeItem(KEY)
    return REASONS[reason] || null
  } catch {
    return null
  }
}
