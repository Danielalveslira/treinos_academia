// Never spread user-controlled profile fields into an administrative identity.
export function accountView(id, data = {}, email = null) {
  const fields = [
    'username',
    'role',
    'accountStatus',
    'disabledReason',
    'createdAt',
    'subscription',
  ]
  const result = { id, email }
  for (const key of fields) if (data[key] !== undefined) result[key] = serialize(data[key])
  return result
}

function serialize(value) {
  if (value?.toDate) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]))
  }
  return value
}
