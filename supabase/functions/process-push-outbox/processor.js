import { renderPushMessage, workoutReminderMessage } from './messages.js'

export { workoutReminderMessage }

const DEFAULT_LIMIT = 25
const DEFAULT_SEND_TIMEOUT_MS = 10000

// Mesma allowlist da migration (private.is_push_endpoint_allowed): o endpoint vem do cliente e o
// worker faz POST nele, então só os serviços de push dos navegadores são aceitos.
const PUSH_ENDPOINT_PATTERN =
  /^https:\/\/(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)\//i

const ACK_TOKEN_PATTERN = /^[0-9a-f]{64}$/

const COALESCED_TYPES = new Set([
  'post_like',
  'comment_like',
  'admin_report',
  'admin_appeal',
  'admin_privacy_request',
])

// Hash curto e estável para a `tag` (agrupa no aparelho sem expor o caminho no payload).
function shortHash(value) {
  let hash = 5381
  for (const character of String(value)) hash = ((hash << 5) + hash + character.charCodeAt(0)) >>> 0
  return hash.toString(36)
}

export function isAllowedPushEndpoint(value) {
  return typeof value === 'string' && value.length <= 4096 && PUSH_ENDPOINT_PATTERN.test(value)
}

// Mesma regra do Service Worker e da Central: só caminho interno, sem "//", "\\", espaço nem
// caracteres de controle (o navegador remove tab/nova linha, e "/<TAB>/host" viraria "//host").
export function safeTargetUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length > 300 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0020\u007f-\u009f\u2028\u2029]/.test(value)
  ) {
    return '/'
  }
  return value
}

export function buildPushPayload(job) {
  const { title, body } = renderPushMessage(job)
  const payload = {
    notificationId: String(job.notification_id),
    title,
    body,
    type: job.notification_type,
    targetUrl: job.notification_type === 'push_welcome' ? '/app' : safeTargetUrl(job.action_url),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  }
  // Curtidas e alertas administrativos em rajada compartilham a `tag`: um Push novo SUBSTITUI o
  // anterior no aparelho em vez de empilhar (o Service Worker usa renotify para ainda avisar).
  if (COALESCED_TYPES.has(job.notification_type)) {
    payload.tag = `${job.notification_type}:${shortHash(job.action_url || job.notification_type)}`
  }
  // Token opaco da entrega (telemetria). Viaja DENTRO do payload criptografado, só o aparelho o lê;
  // o Service Worker o devolve para registrar quando o Push chegou. Formato inválido = sem telemetria.
  if (typeof job.ack_token === 'string' && ACK_TOKEN_PATTERN.test(job.ack_token))
    payload.ack = job.ack_token
  return payload
}

const URGENCIES = new Set(['very-low', 'low', 'normal', 'high'])

// Urgência e TTL vêm do catálogo do banco (uma linha por tipo). Valores inesperados caem em
// padrões seguros em vez de quebrar o envio.
export function pushSendOptions(job, now) {
  if (job.notification_type === 'push_welcome') {
    const remaining = Math.ceil((Date.parse(job.metadata?.expiresAt) - (now ?? Date.now())) / 1000)
    return {
      urgency: 'high',
      ttl: Number.isFinite(remaining) ? Math.max(0, Math.min(600, remaining)) : 0,
    }
  }
  const ttl = Number(job.ttl_seconds)
  return {
    urgency: URGENCIES.has(job.urgency) ? job.urgency : 'normal',
    ttl: Number.isInteger(ttl) && ttl >= 60 && ttl <= 2419200 ? ttl : 86400,
  }
}

// Código HTTP que o Push Service realmente respondeu. Nunca é inventado: sem resposta legível, nulo.
export function acceptedHttpStatus(response) {
  const status = Number(response?.statusCode ?? response?.status)
  return Number.isInteger(status) && status >= 200 && status < 300 ? status : null
}

export function classifyPushError(error) {
  const status = Number(error?.statusCode || error?.status || 0) || null
  if (status === 404 || status === 410) return { outcome: 'expired', http_status: status }
  if (status === 429 || status >= 500 || !status)
    return { outcome: 'transient', http_status: status }
  return { outcome: 'permanent', http_status: status }
}

export function safePushError(error, job) {
  let message = String(error?.message || 'PUSH_SEND_FAILED')
  for (const secret of [job.endpoint, job.p256dh, job.auth]) {
    if (typeof secret === 'string' && secret) message = message.split(secret).join('[redacted]')
  }
  // Rede de segurança: qualquer URL ou token longo (chave, JWT, endpoint de outro formato) sai do log.
  message = message
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
  return message.slice(0, 500)
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error('PUSH_SEND_TIMEOUT'), { code: 'ETIMEDOUT' })),
      ms
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function processPushOutbox(
  admin,
  sendNotification,
  {
    workerId = crypto.randomUUID(),
    limit = DEFAULT_LIMIT,
    sendTimeoutMs = DEFAULT_SEND_TIMEOUT_MS,
    clock = () => new Date(),
  } = {}
) {
  // Instante em que este ciclo do worker começou (telemetria: separa "esperou o cron" de "o worker
  // demorou"). O banco descarta horários implausíveis.
  const workerStartedAt = clock().toISOString()
  const { data: jobs, error: claimError } = await admin.rpc('claim_push_jobs', {
    p_worker_id: workerId,
    p_limit: Math.min(Math.max(limit, 1), 100),
  })
  if (claimError) throw claimError

  const uniqueJobs = [...new Map((jobs || []).map((job) => [job.delivery_id, job])).values()]
  const results = await Promise.all(
    uniqueJobs.map(async (job) => {
      if (!isAllowedPushEndpoint(job.endpoint)) {
        // Nunca chama um host fora da allowlist; a subscription é revogada pelo outcome `expired`.
        return {
          delivery_id: job.delivery_id,
          outcome: 'expired',
          http_status: null,
          error: 'ENDPOINT_NOT_ALLOWED',
          worker_started_at: workerStartedAt,
        }
      }
      const options = pushSendOptions(
        job,
        job.notification_type === 'push_welcome' ? clock().getTime() : undefined
      )
      if (job.notification_type === 'push_welcome' && options.ttl <= 0) {
        return {
          delivery_id: job.delivery_id,
          outcome: 'permanent',
          http_status: null,
          error: 'WELCOME_EXPIRED',
          worker_started_at: workerStartedAt,
        }
      }
      try {
        const response = await withTimeout(
          sendNotification(
            { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } },
            buildPushPayload(job),
            options
          ),
          sendTimeoutMs
        )
        return {
          delivery_id: job.delivery_id,
          outcome: 'sent',
          http_status: acceptedHttpStatus(response),
          error: null,
          worker_started_at: workerStartedAt,
          provider_accepted_at: clock().toISOString(),
        }
      } catch (error) {
        const classified = classifyPushError(error)
        return {
          delivery_id: job.delivery_id,
          ...classified,
          error: safePushError(error, job),
          worker_started_at: workerStartedAt,
        }
      }
    })
  )

  if (uniqueJobs.length) {
    const { error } = await admin.rpc('finish_push_batch', {
      p_worker_id: workerId,
      p_results: results,
    })
    if (error) throw error
  }
  return {
    claimed: uniqueJobs.length,
    sent: results.filter((item) => item.outcome === 'sent').length,
    failed: results.filter((item) => item.outcome !== 'sent').length,
  }
}
