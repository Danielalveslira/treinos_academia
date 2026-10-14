export function publicationErrorMessage(error) {
  if (error?.code === 'PT429' || error?.message === 'PUBLICATION_RATE_LIMITED') {
    return 'Limite de publicações atingido. Aguarde antes de tentar novamente.'
  }
  return 'Não foi possível publicar. Tente novamente.'
}
