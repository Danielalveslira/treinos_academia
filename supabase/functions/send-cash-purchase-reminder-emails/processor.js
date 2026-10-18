import { buildReminderEmail } from './messages.js'

const DEFAULT_LIMIT = 25
const DEFAULT_SEND_TIMEOUT_MS = 10000
const MAX_ATTEMPTS = 5

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('EMAIL_SEND_TIMEOUT'), { code: 'ETIMEDOUT' })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Never a message that could carry the recipient's own address back into a log line.
function safeEmailError(error, job) {
  let message = String(error?.message || 'EMAIL_SEND_FAILED')
  if (typeof job.email === 'string' && job.email) message = message.split(job.email).join('[redacted]')
  return message.slice(0, 500)
}

export async function processCashPurchaseReminders(
  admin,
  {
    workerId = crypto.randomUUID(),
    limit = DEFAULT_LIMIT,
    sendTimeoutMs = DEFAULT_SEND_TIMEOUT_MS,
    resendApiKey,
    fromAddress,
    appUrl,
    supportEmail,
    fetcher = fetch,
  } = {}
) {
  const { data: jobs, error: claimError } = await admin.rpc('claim_cash_purchase_reminder_jobs', {
    p_worker_id: workerId,
    p_limit: Math.min(Math.max(limit, 1), 100),
  })
  if (claimError) throw claimError

  const results = await Promise.all(
    (jobs || []).map(async (job) => {
      if (!job.email || !job.username) {
        return { id: job.id, outcome: 'failed', error: 'RECIPIENT_NOT_FOUND' }
      }
      const { subject, html, text } = buildReminderEmail({
        username: job.username,
        packageLabel: job.package_label,
        cashAmount: job.cash_amount,
        amountCentavos: job.amount_centavos,
        createdAt: job.purchase_created_at,
        appUrl,
        supportEmail,
        purchaseId: job.purchase_id,
      })
      try {
        // Same key (the queue row's own id, a UUID) on every attempt for this job --
        // Resend keeps idempotency keys for 24h and returns the original response instead
        // of sending again when the same key/payload repeats (docs: "Idempotency Keys",
        // resend.com/docs/api-reference/idempotency-keys). A retry after a timeout reuses
        // this exact header, so a reply we never saw never turns into a duplicate email.
        const response = await withTimeout(
          fetcher('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': job.id,
            },
            body: JSON.stringify({ from: fromAddress, to: job.email, subject, html, text }),
          }),
          sendTimeoutMs
        )
        if (response.ok) return { id: job.id, outcome: 'sent' }
        // Resend's documented idempotency error types (resend.com/docs/api-reference/errors):
        //  - 409 concurrent_idempotent_requests: another request with this SAME key is still
        //    in flight (e.g. our own previous attempt hadn't timed out on Resend's side yet,
        //    or two workers briefly overlapped on a reclaimed lease) -- transient, safe to
        //    retry with the same key.
        //  - 409 invalid_idempotent_request / 400 invalid_idempotency_key: the key was reused
        //    with a body that doesn't match, or the key itself is malformed -- can only
        //    happen from a real bug (this job's payload is deterministic, and job.id is
        //    always a valid UUID), so it is never retried, only logged and failed.
        const errorBody = await response.json().catch(() => null)
        const errorType = errorBody?.name
        const errorTag = `RESEND_HTTP_${response.status}${errorType ? `_${errorType}` : ''}`
        if (errorType === 'invalid_idempotent_request' || errorType === 'invalid_idempotency_key') {
          return { id: job.id, outcome: 'failed', error: errorTag }
        }
        // Anything else at 409 (including concurrent_idempotent_requests, or an
        // unrecognized future error type) is treated as transient by default: retrying with
        // the SAME Idempotency-Key is always safe, it either settles or repeats the same 409.
        const transient = response.status === 429 || response.status >= 500 || response.status === 409
        if (transient && job.attempt_count < MAX_ATTEMPTS) {
          return { id: job.id, outcome: 'retry', error: errorTag }
        }
        return { id: job.id, outcome: 'failed', error: errorTag }
      } catch (error) {
        const outcome = job.attempt_count < MAX_ATTEMPTS ? 'retry' : 'failed'
        return { id: job.id, outcome, error: safeEmailError(error, job) }
      }
    })
  )

  if (results.length) {
    const { error } = await admin.rpc('finish_cash_purchase_reminder_batch', {
      p_worker_id: workerId,
      p_results: results,
    })
    if (error) throw error
  }

  return {
    claimed: results.length,
    sent: results.filter((item) => item.outcome === 'sent').length,
    retried: results.filter((item) => item.outcome === 'retry').length,
    failed: results.filter((item) => item.outcome === 'failed').length,
  }
}
