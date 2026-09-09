export function validateBillingConfig(config) {
  if (
    !config ||
    !Array.isArray(config.plans) ||
    config.plans.length < 1 ||
    config.plans.length > 10
  )
    return 'Informe de 1 a 10 planos.'
  const ids = new Set()
  for (const plan of config.plans) {
    if (
      !plan ||
      typeof plan.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(plan.id) ||
      ids.has(plan.id) ||
      typeof plan.name !== 'string' ||
      !plan.name.trim() ||
      plan.name.length > 60 ||
      !Number.isFinite(plan.price) ||
      plan.price < 0 ||
      plan.price > 100000 ||
      plan.billingCycle !== 'monthly' ||
      (plan.highlight !== undefined && typeof plan.highlight !== 'boolean')
    )
      return 'Plano inválido: confira nome, valor e identificador.'
    ids.add(plan.id)
  }
  for (const [field, max] of [
    ['trialDays', 365],
    ['warningDaysBeforeDue', 30],
    ['graceBusinessDays', 30],
  ]) {
    if (!Number.isInteger(config[field]) || config[field] < 0 || config[field] > max)
      return `Informe ${field === 'trialDays' ? 'o período de teste' : field === 'warningDaysBeforeDue' ? 'o aviso de vencimento' : 'a tolerância'} entre 0 e ${max} dias inteiros.`
  }
  for (const field of ['pixKey', 'receiverName', 'whatsapp'])
    if (typeof config[field] !== 'string' || config[field].length > 200)
      return 'Dados de pagamento inválidos.'
  if (!['email', 'cpf', 'cnpj', 'phone', 'random'].includes(config.pixKeyType))
    return 'Tipo de chave PIX inválido.'
  return null
}
