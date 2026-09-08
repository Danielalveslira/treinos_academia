const MESSAGES = {
  'permission-denied':
    'Você não tem permissão para acessar esses dados. Verifique se as regras de segurança do Firestore foram publicadas.',
  unauthenticated: 'Sua sessão expirou. Faça login novamente.',
  unavailable: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
  'resource-exhausted':
    'Limite gratuito do Firestore atingido no momento. Tente novamente em alguns minutos.',
  'deadline-exceeded': 'O servidor demorou demais para responder. Tente novamente.',
  cancelled: 'A operação foi cancelada. Tente novamente.',
}

const INDEX_URL_PATTERN = /(https:\/\/console\.firebase\.google\.com\S+)/

export function describeFirestoreError(error, context) {
  console.error(`[Firestore] ${context}:`, error)

  if (error?.code === 'failed-precondition' && INDEX_URL_PATTERN.test(error.message)) {
    const [, url] = error.message.match(INDEX_URL_PATTERN)
    return {
      message:
        'Esta consulta precisa de um índice do Firestore. Se você já criou o índice, aguarde alguns minutos até o status mudar para "Ativado" no console do Firebase e tente novamente.',
      actionLabel: 'Ver índice no console',
      actionHref: url,
    }
  }

  return {
    message: MESSAGES[error?.code] || 'Não foi possível carregar os dados. Tente novamente.',
  }
}
