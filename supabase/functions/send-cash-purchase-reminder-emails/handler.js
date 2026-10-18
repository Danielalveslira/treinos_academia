// Same gate as process-push-outbox/handler.js: a request without the worker secret never
// touches the queue. Kept local (not in _shared) because each worker owns its own secret
// name/header -- nothing here is specific to email besides the header name.
export const WORKER_SECRET_HEADER = 'x-cash-reminder-worker-secret'
const MIN_SECRET_LENGTH = 32

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

export async function secretsMatch(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false
  const [a, b] = await Promise.all([digest(received), digest(expected)])
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index]
  return diff === 0
}

function json(body, status) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status })
}

export function createWorkerHandler({ workerSecret, resendReady, run, logError = () => {} }) {
  return async function handle(req) {
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (typeof workerSecret !== 'string' || workerSecret.length < MIN_SECRET_LENGTH) {
      logError('[CashReminder] CASH_REMINDER_WORKER_SECRET missing or too short')
      return json({ error: 'CASH_REMINDER_NOT_CONFIGURED' }, 503)
    }
    if (!(await secretsMatch(req.headers.get(WORKER_SECRET_HEADER), workerSecret))) {
      return json({ error: 'UNAUTHORIZED' }, 401)
    }
    if (!resendReady) return json({ error: 'CASH_REMINDER_NOT_CONFIGURED' }, 503)
    try {
      return json(await run(), 200)
    } catch (error) {
      logError('[CashReminder] worker failed', error?.code ?? error?.name ?? error?.message)
      return json({ error: 'CASH_REMINDER_WORKER_FAILED' }, 500)
    }
  }
}
