const MESSAGES = {
  'permission-denied': 'Você não tem permissão para acessar esses dados.',
  unauthenticated: 'Sua sessão expirou. Faça login novamente.',
  unavailable: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
}

const INDEX_URL_PATTERN = /(https:\/\/console\.firebase\.google\.com\S+)/

export function describeFirestoreError(error, context) {
  console.error(`[Firestore] ${context}:`, error)

  if (error?.code === 'failed-precondition' && INDEX_URL_PATTERN.test(error.message)) {
    const [, url] = error.message.match(INDEX_URL_PATTERN)
    return {
      message: 'Esta consulta precisa de um índice do Firestore que ainda não foi criado.',
      actionLabel: 'Criar índice',
      actionHref: url,
    }
  }

  return {
    message: MESSAGES[error?.code] || 'Não foi possível carregar os dados. Tente novamente.',
  }
}
