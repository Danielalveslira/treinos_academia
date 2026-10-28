export const PRICE_FIELDS = [
  ['unitPriceCentavos', 'Preço de 1 EvoCash (R$)', 'money'],
  ['minimumUnitPriceCentavos', 'Preço mínimo permitido (R$)', 'money'],
  ['minQuantity', 'Quantidade mínima por compra', 'integer'],
  ['maxQuantity', 'Quantidade máxima por compra', 'integer'],
  ['dailyQuantityLimit', 'Limite diário por pessoa (EvoCash)', 'integer'],
  ['totalQuantityLimit', 'Limite total por pessoa (EvoCash)', 'integer'],
  ['quoteTtlSeconds', 'Validade da cotação (segundos)', 'integer'],
  ['largeChangeThresholdBps', 'Confirmar novamente a partir de (pontos-base)', 'integer'],
]

export function parsePriceBRL(value) {
  if (!/^(0|[1-9][0-9]{0,7})(,[0-9]{1,2})?$/.test(value)) throw new Error('INVALID_PRICE_CONFIG')
  const [whole, fraction = ''] = value.split(',')
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString()
}

export function formatPriceBRL(cents) {
  if (typeof cents !== 'string' || !/^[0-9]+$/.test(cents)) return '—'
  const value = BigInt(cents)
  return `R$ ${(value / 100n).toLocaleString('pt-BR')},${(value % 100n).toString().padStart(2, '0')}`
}

export function priceForm(version) {
  return Object.fromEntries(
    PRICE_FIELDS.map(([key, , type]) => {
      const value = version?.[key] ?? ''
      return [
        key,
        type === 'money' && value !== ''
          ? `${BigInt(value) / 100n},${(BigInt(value) % 100n).toString().padStart(2, '0')}`
          : value,
      ]
    })
  )
}

export function priceConfig(form) {
  return Object.fromEntries(
    PRICE_FIELDS.map(([key, , type]) => {
      const value = form[key]?.trim() ?? ''
      if (type === 'money') return [key, parsePriceBRL(value)]
      if (!/^(0|[1-9][0-9]{0,9})$/.test(value)) throw new Error('INVALID_PRICE_CONFIG')
      return [key, value]
    })
  )
}

export function pricingError(error) {
  const messages = {
    INVALID_PRICE_CONFIG:
      'Confira os valores, limites e centavos. Quantidades devem ser inteiras; o preço usa vírgula e até duas casas decimais.',
    PRICE_RATE_LIMIT:
      'Muitas publicações em sequência. Aguarde um minuto antes de tentar novamente.',
    INVALID_QUANTITY:
      'Informe quantidades inteiras dentro dos limites, separadas por ponto e vírgula.',
    PRICE_REVISION_CONFLICT:
      'A configuração foi alterada em outra sessão. Atualize os dados e simule novamente.',
    INVALID_PRICE_START:
      'A data de início deve estar no futuro. Para vigência imediata, deixe o campo vazio.',
    PRICE_START_CONFLICT:
      'Já existe uma versão com início posterior. Escolha uma data depois da última vigência programada.',
    RECENT_AUTH_REQUIRED: 'Confirme sua senha para publicar esta alteração.',
    REAUTHENTICATION_FAILED: 'Não foi possível confirmar sua senha. Tente novamente.',
    PERMISSION_DENIED: 'Sua conta ou sessão não permite esta operação.',
    IDEMPOTENCY_CONFLICT: 'Esta tentativa já foi registrada com outros dados. Atualize a página.',
    ADDITIONAL_CONFIRMATION_REQUIRED: 'Esta mudança exige a confirmação adicional de impacto.',
  }
  return messages[error?.message] || 'Não foi possível concluir a solicitação. Tente novamente.'
}

export function priceDate(value) {
  return value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Sao_Paulo',
      }).format(new Date(value)) + ' (Brasília)'
    : '—'
}

export function formatPriceChange(basisPoints) {
  if (typeof basisPoints !== 'string' || !/^-?[0-9]+$/.test(basisPoints)) return '—'
  const value = BigInt(basisPoints)
  const absolute = value < 0n ? -value : value
  return `${value < 0n ? '-' : '+'}${absolute / 100n},${(absolute % 100n).toString().padStart(2, '0')}%`
}
