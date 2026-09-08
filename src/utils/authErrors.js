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
