// Realtime invalidates decisions; only the backend can authorize delivery.
// Three short leases bridge a transient channel outage. Exhaustion fails closed
// until SUBSCRIBED; focus/error storms cannot reset the recovery budget.
export const RECOVERY_LEASE_MS = 5000
export const RECOVERY_ATTEMPTS = 3
const events = []
export function advertisingOperationalEvent(scope, type) {
  const event = { scope: String(scope).split(':')[0], type, at: Date.now() }
  events.push(event)
  if (events.length > 100) events.shift()
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('advertising-operational', { detail: event }))
}
export const getAdvertisingOperationalEvents = () => events.map((event) => ({ ...event }))
export function createAdvertisingRecovery() {
  let disconnected = false
  let attempts = 0
  return {
    status(status) {
      if (status === 'SUBSCRIBED') {
        disconnected = false
        attempts = 0
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        disconnected = true
      }
    },
    begin(now) {
      if (!disconnected) return Infinity
      if (attempts >= RECOVERY_ATTEMPTS) return null
      attempts++
      return now + RECOVERY_LEASE_MS
    },
    get disconnected() {
      return disconnected
    },
  }
}

export function advertisingFailureType(error) {
  return ['42501', 'PGRST301', 'PGRST302'].includes(error?.code) ||
    [401, 403].includes(error?.status)
    ? 'backend_authorization_failed'
    : 'backend_query_failed'
}
