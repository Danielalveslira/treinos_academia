import { validId } from './legal-core.js'

// Never spread user-controlled profile fields into an administrative identity.
export function accountView(id, data = {}, email = null) {
  const fields = ['username', 'role', 'accountStatus', 'disabledReason', 'createdAt']
  const result = { id, email }
  for (const key of fields) if (data[key] !== undefined) result[key] = serialize(data[key])
  return result
}

export function validateSetAccountStatus(data) {
  if (!validId(data?.userId)) return 'Usuário inválido.'
  if (typeof data?.disabled !== 'boolean') return 'Informe o novo estado da conta.'
  if (data.disabled) {
    if (
      typeof data.reason !== 'string' ||
      data.reason.trim().length < 5 ||
      data.reason.length > 500
    ) {
      return 'Informe o motivo da desativação (5 a 500 caracteres).'
    }
  }
  return null
}

export function validateDeleteAccount(data) {
  if (!validId(data?.userId)) return 'Usuário inválido.'
  if (data?.confirmation !== 'EXCLUIR') return 'Digite EXCLUIR para confirmar.'
  return null
}

// Exportado para reuso por qualquer outro serviço admin que devolva Timestamps do
// Firestore por uma callable (ver listBlockedForReview em deletion-service.js) --
// datas nunca voltam cruas: o SDK cliente de callable não reconstrói Timestamp/GeoPoint
// automaticamente como um snapshot de leitura faz, então toda data vira string ISO aqui.
export function serialize(value) {
  if (value?.toDate) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]))
  }
  return value
}
