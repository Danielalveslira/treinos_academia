import { describeAccountAccessError } from './accountAccessErrors'

const STATUS_EDIT_ERROR_MESSAGES = {
  STATUS_NOT_FOUND: 'Esta publicação não está mais disponível.',
  STATUS_EXPIRED: 'Esta publicação expirou e não pode mais ser editada.',
  EDIT_CONFLICT: 'A publicação mudou enquanto você editava. Atualize e tente novamente.',
  INVALID_BODY: 'Verifique o conteúdo: ele não pode ficar vazio nem passar do limite.',
  EDIT_NOT_SUPPORTED_FOR_TYPE: 'Este tipo de publicação ainda não pode ser editado.',
}

export function describeStatusEditError(error) {
  const code = error?.message
  return (
    STATUS_EDIT_ERROR_MESSAGES[code] ||
    describeAccountAccessError(code) ||
    'Não foi possível salvar as alterações. Tente novamente.'
  )
}
