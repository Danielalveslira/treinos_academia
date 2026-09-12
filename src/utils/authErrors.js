const MESSAGES = {
  'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/weak-password': 'A senha deve ter pelo menos 6 caracteres.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
}

export function translateAuthError(error) {
  return MESSAGES[error?.code] || 'Ocorreu um erro. Tente novamente.'
}

// Confirma que a conta não existe mais (ou foi desabilitada) no Firebase Auth — usado
// por AuthContext pra decidir se um permission-denied na leitura do próprio perfil é uma
// "sessão fantasma" (conta excluída/desabilitada por um admin em outro lugar) e não um
// problema transitório de rede/regras. getIdToken(true) é a forma que o próprio Firebase
// recomenda pra perceber revokeRefreshTokens()/deleteUser() já executados no servidor: o
// token em cache no navegador continua parecendo válido pro SDK até expirar sozinho (até
// 1h) ou até algo forçar essa renovação — sem isso, o app nunca percebe a exclusão sozinho.
const ACCOUNT_GONE_CODES = new Set([
  'auth/user-disabled',
  'auth/user-token-expired',
  'auth/user-not-found',
  'auth/invalid-user-token',
])

export function isAccountGoneError(error) {
  return ACCOUNT_GONE_CODES.has(error?.code)
}
