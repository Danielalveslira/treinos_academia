const DEFAULT_LIMIT = 25

const CONTENT = {
  post_reply: ['Novo comentário', 'Alguém comentou na sua publicação.'],
  comment_reply: ['Nova resposta', 'Alguém respondeu seu comentário.'],
  comment_mention: ['Nova menção', 'Alguém mencionou você em um comentário.'],
  comment_like: ['Nova curtida', 'Alguém curtiu seu comentário.'],
  admin_report: ['Nova denúncia', 'Uma denúncia aguarda análise.'],
  admin_appeal: ['Novo recurso', 'Um recurso aguarda análise.'],
  admin_privacy_request: ['Solicitação de privacidade', 'Uma solicitação aguarda análise.'],
  admin_moderation_decision: ['Decisão de moderação', 'Uma decisão de moderação foi registrada.'],
  admin_restriction: ['Aviso da conta', 'Uma restrição foi aplicada.'],
  admin_deletion_review: ['Revisão de exclusão', 'Uma exclusão aguarda revisão.'],
  admin_broadcast: ['Aviso do Evolutus', 'Você recebeu um aviso importante.'],
}

export function safeTargetUrl(value) {
  if (typeof value !== 'string' || value.length > 300 || !value.startsWith('/') || value.startsWith('//')) {
    return '/'
  }
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  return hasControlCharacter ? '/' : value
}

export function buildPushPayload(job) {
  const [fallbackTitle, fallbackBody] = CONTENT[job.notification_type] || ['Nova notificação', 'Você recebeu uma nova notificação.']
  const metadata = job.metadata && typeof job.metadata === 'object' ? job.metadata : {}
  const broadcast = job.notification_type === 'admin_broadcast'
  const body = broadcast && typeof metadata.body === 'string' ? metadata.body.slice(0, 240) : fallbackBody
  const actor = typeof job.actor_username === 'string' && job.actor_username.trim()
    ? `@${job.actor_username.trim()}`
    : null
  const title = broadcast && typeof metadata.title === 'string' ? metadata.title.slice(0, 120)
    : actor && ['post_reply', 'comment_reply', 'comment_mention', 'comment_like'].includes(job.notification_type)
    ? `${actor}: ${fallbackTitle.toLowerCase()}`
    : fallbackTitle
  return {
    notificationId: String(job.notification_id),
    title,
    body,
    type: job.notification_type,
    targetUrl: safeTargetUrl(job.action_url),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  }
}

export function classifyPushError(error) {
  const status = Number(error?.statusCode || error?.status || 0) || null
  if (status === 404 || status === 410) return { outcome: 'expired', http_status: status }
  if (status === 429 || status >= 500 || !status) return { outcome: 'transient', http_status: status }
  return { outcome: 'permanent', http_status: status }
}

export function safePushError(error, job) {
  let message = String(error?.message || 'PUSH_SEND_FAILED')
  for (const secret of [job.endpoint, job.p256dh, job.auth]) {
    if (typeof secret === 'string' && secret) message = message.split(secret).join('[redacted]')
  }
  return message.slice(0, 500)
}

export async function processPushOutbox(admin, sendNotification, { workerId = crypto.randomUUID(), limit = DEFAULT_LIMIT } = {}) {
  const { data: jobs, error: claimError } = await admin.rpc('claim_push_jobs', {
    p_worker_id: workerId,
    p_limit: Math.min(Math.max(limit, 1), 100),
  })
  if (claimError) throw claimError

  const uniqueJobs = [...new Map((jobs || []).map((job) => [job.delivery_id, job])).values()]
  const results = await Promise.all(uniqueJobs.map(async (job) => {
    try {
      await sendNotification(
        { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } },
        buildPushPayload(job)
      )
      return { delivery_id: job.delivery_id, outcome: 'sent', http_status: 201, error: null }
    } catch (error) {
      const classified = classifyPushError(error)
      return {
        delivery_id: job.delivery_id,
        ...classified,
        error: safePushError(error, job),
      }
    }
  }))

  if (uniqueJobs.length) {
    const { error } = await admin.rpc('finish_push_batch', { p_worker_id: workerId, p_results: results })
    if (error) throw error
  }
  return {
    claimed: uniqueJobs.length,
    sent: results.filter((item) => item.outcome === 'sent').length,
    failed: results.filter((item) => item.outcome !== 'sent').length,
  }
}
