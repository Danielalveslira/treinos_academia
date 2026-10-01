const MESSAGES = {
  '42501': 'Não foi possível acessar esses dados. Tente novamente ou entre em contato com o suporte.',
  PGRST301: 'Sua sessão expirou. Faça login novamente.',
}

export function describeQueryError(error, context) {
  console.error(`[query] ${context}:`, error)
  return {
    message: MESSAGES[error?.code] || 'Não foi possível carregar os dados. Tente novamente.',
  }
}
