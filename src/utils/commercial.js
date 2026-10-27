const errors = {
  PRICE_REVISION_CONFLICT: 'A configuração mudou. Atualize os dados antes de confirmar.',
  ENTITLEMENT_REVISION_CONFLICT: 'O direito mudou. Atualize os dados antes de confirmar.',
  RECENT_AUTH_REQUIRED: 'Confirme sua senha novamente.',
  REAUTHENTICATION_FAILED: 'Não foi possível confirmar sua senha.',
  INVALID_COMMERCIAL_PRICE:
    'Informe preço inteiro positivo e limites válidos, sem exceder o total permitido.',
  COMMERCIAL_INTEGRATION_UNAVAILABLE:
    'Este serviço ainda não possui integração editorial habilitada.',
  COMMERCIAL_SALES_PAUSED: 'Novas contratações estão indisponíveis.',
  RESOURCE_NOT_ELIGIBLE:
    'O recurso precisa pertencer à sua conta e estar aprovado na versão atual.',
  ENTITLEMENT_BLOCKED: 'Este direito está suspenso ou revogado. Pagamento não remove o bloqueio.',
  QUOTE_EXPIRED: 'A cotação venceu. Solicite uma nova antes de confirmar.',
  INVALID_DURATION: 'Informe uma quantidade inteira de dias dentro dos limites.',
  REVERSE_LATEST_ORDER_FIRST: 'Reverta primeiro a contratação mais recente deste recurso.',
  APP_ACCESS_DENIED: 'Sua sessão ou conta não está autorizada. Entre novamente.',
  PRICE_RATE_LIMIT: 'Aguarde antes de publicar outra alteração.',
  COMMERCIAL_RATE_LIMIT: 'Aguarde antes de solicitar outra cotação.',
}
export function commercialError(error) {
  return (
    errors[error?.message] ||
    (error?.message === 'Saldo de EvoCash insuficiente.'
      ? error.message
      : 'Não foi possível concluir. Atualize os dados e tente novamente.')
  )
}
export function commercialDate(value) {
  return value
    ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (Brasília)'
    : '—'
}
export function validCommercialPrice(price, min, max) {
  if (![price, min, max].every((v) => /^[1-9][0-9]{0,9}$/.test(v))) return false
  return (
    BigInt(min) <= BigInt(max) && BigInt(max) <= 3650n && BigInt(price) * BigInt(max) <= 2147483647n
  )
}
