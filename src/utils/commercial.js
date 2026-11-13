import { commercialTermsError } from './commercialTerms.js'
const errors = {
  AD_CAPACITY_UNAVAILABLE:
    'Não há disponibilidade para todo o período. Nenhum EvoCash foi debitado.',
  AD_PLACEMENT_UNAVAILABLE: 'Este posicionamento está indisponível para novas contratações.',
  AD_CAPACITY_COMMITTED:
    'A capacidade já está comprometida por contratos. Preserve as reservas existentes.',
  AD_CONFIGURATION_CONFLICT: 'A configuração mudou. Atualize antes de confirmar.',
  AD_COMMUNITY_PERMISSION_REQUIRED:
    'O proprietário precisa permitir esta modalidade na central de publicidade.',
  AD_COMMUNITY_NOT_AUTHORIZED: 'A comunidade ou conteúdo não está autorizado para esta campanha.',
  LEGACY_PROMOTION_ACTIVE:
    'Aguarde o término do destaque atual antes de contratar pelo novo modelo.',
  PROMOTION_SOURCE_EXPIRES: 'A publicação não está mais disponível para uma nova contratação.',
  INVALID_AD_MEDIA: 'Escolha uma imagem enviada para esta campanha.',
  PROMOTION_SOURCE_CHANGED:
    'A publicação mudou ou deixou de ser elegível. Atualize e tente novamente.',
  PROMOTION_REVISION_CONFLICT:
    'Esta solicitação foi decidida, alterada ou reenviada por outra sessão. A lista foi atualizada; revise novamente.',
  PROMOTION_NOT_FOUND: 'Esta solicitação não foi encontrada. Atualize a lista.',
  AD_NETWORK_UNCONFIGURED: 'O pacote global ainda não foi configurado pela administração.',
  AD_ACCOUNT_NOT_ELIGIBLE: 'Esta conta de anunciante não está disponível para contratação.',

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
    commercialTermsError(error) ||
    (error?.message === 'Saldo de EvoCash insuficiente.'
      ? error.message
      : 'Não foi possível concluir. Atualize os dados e tente novamente.')
  )
}
// A desired duration chosen earlier (e.g. the ad wizard's draft) is only ever a
// suggestion: the current tariff's minDays/maxDays always win.
export function clampInitialDays(initialDays, tariff) {
  const min = Number(tariff?.minDays) || 1
  const max = Number(tariff?.maxDays) || 3650
  return String(Math.min(Math.max(Number(initialDays) || min, min), max))
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
