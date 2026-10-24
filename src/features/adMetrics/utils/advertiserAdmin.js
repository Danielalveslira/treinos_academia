export function isAdvertiserAccessDenied(error) {
  return error?.code === '42501' || /PERMISSION_DENIED|SESSION_REVOKED/.test(error?.message || '')
}
export function advertiserError(error) {
  if (isAdvertiserAccessDenied(error))
    return 'Acesso negado. Confirme sua sessão e as permissões de superadmin.'
  if (/CAMPAIGN_OWNER_IMMUTABLE|duplicate key/.test(error?.message || ''))
    return 'Esta campanha já possui um anunciante. A titularidade não pode ser transferida. Atualize as campanhas disponíveis.'
  return 'Não foi possível concluir a operação. Verifique a conexão e tente novamente.'
}
export function advertiserDate(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Data não informada'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value))
}
