export function checkoutRequestId(
  userId,
  quoteId,
  storage = globalThis.sessionStorage,
  generate = () => crypto.randomUUID()
) {
  const key = `evocash:checkout:${userId}:${quoteId}`
  const existing = storage.getItem(key)
  if (existing && /^[a-f0-9-]{36}$/i.test(existing)) return existing
  const id = generate()
  storage.setItem(key, id)
  return id
}
export function purchaseError(error) {
  return (
    {
      EVOCASH_PURCHASES_PAUSED: 'As compras de EvoCash estão pausadas. Tente novamente mais tarde.',
      EVOCASH_QUOTES_PAUSED: 'As novas cotações estão pausadas. Tente novamente mais tarde.',
      EVOCASH_PRICE_UNAVAILABLE: 'O preço não está disponível. Tente novamente mais tarde.',
      INVALID_QUANTITY: 'Confira a quantidade: use um número inteiro dentro dos limites.',
      QUOTE_EXPIRED: 'Esta cotação expirou. Atualize a cotação para continuar.',
      QUOTE_NOT_FOUND: 'Esta cotação não está disponível para sua conta. Faça uma nova cotação.',
      QUOTE_ALREADY_RESERVED: 'Esta cotação já foi utilizada. Consulte Minhas compras.',
      IDEMPOTENCY_CONFLICT:
        'A tentativa já foi registrada com outros dados. Consulte Minhas compras.',
      PURCHASE_ALREADY_FINAL:
        'Esta compra já foi encerrada. Consulte o histórico e faça uma nova cotação, se necessário.',
      PURCHASE_LIMIT_REACHED:
        'O limite de compras da sua conta foi atingido, incluindo valores em andamento.',
      PENDING_CASH_PURCHASE_EXISTS: 'Você já tem uma compra em andamento. Consulte Minhas compras.',
      CHECKOUT_RATE_LIMIT:
        'Muitas tentativas de compra. Aguarde um minuto antes de tentar novamente.',
      QUOTE_RATE_LIMIT:
        'Muitas cotações em sequência. Aguarde um minuto antes de tentar novamente.',
      CHECKOUT_EXPIRED: 'O prazo deste pagamento terminou. Faça uma nova cotação.',
      CHECKOUT_IN_PROGRESS:
        'O pagamento está sendo preparado. Consulte Minhas compras antes de tentar novamente.',
      CHECKOUT_RECONCILIATION_REQUIRED:
        'Não foi possível confirmar a criação do pagamento. Este pedido está em verificação; não faça outro pagamento para ele.',
      INFINITEPAY_NOT_CONFIGURED: 'O pagamento está temporariamente indisponível.',
      INFINITEPAY_LINK_FAILED:
        'A InfinitePay não iniciou este pagamento. Consulte o histórico e faça uma nova cotação.',
      CHECKOUT_SAVE_FAILED:
        'O link não pôde ser confirmado. Consulte Minhas compras antes de tentar novamente.',
      APP_ACCESS_DENIED: 'Sua sessão ou conta não permite realizar esta compra.',
    }[error?.message] ||
    'Não foi possível concluir a solicitação. Consulte Minhas compras e tente novamente.'
  )
}
