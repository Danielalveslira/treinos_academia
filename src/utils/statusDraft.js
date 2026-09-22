const PREFIX = 'evolutus:status-draft:v1'

export function statusDraftKey(uid, communityId, type) {
  if (!uid || !communityId || !type) return null
  return [PREFIX, uid, communityId, type].map(encodeURIComponent).join(':')
}

function browserStorage(storage) {
  if (storage) return storage
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export function readStatusDraft(uid, communityId, type, storage) {
  const key = statusDraftKey(uid, communityId, type)
  if (!key) return ''
  try {
    const value = browserStorage(storage)?.getItem(key)
    return typeof value === 'string' ? value.slice(0, 500) : ''
  } catch {
    return ''
  }
}

export function saveStatusDraft(uid, communityId, type, value, storage) {
  const key = statusDraftKey(uid, communityId, type)
  const target = browserStorage(storage)
  if (!key || !target) return
  try {
    if (value) target.setItem(key, value.slice(0, 500))
    else target.removeItem(key)
  } catch {
    // Armazenamento local pode estar bloqueado; editar e publicar continuam funcionando.
  }
}

export function clearStatusDraft(uid, communityId, type, storage) {
  const key = statusDraftKey(uid, communityId, type)
  if (!key) return
  try {
    browserStorage(storage)?.removeItem(key)
  } catch {
    // Mesmo fallback de saveStatusDraft: rascunho nunca bloqueia a publicação.
  }
}
