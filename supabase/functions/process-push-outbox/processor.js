const DEFAULT_LIMIT = 25
const DEFAULT_SEND_TIMEOUT_MS = 10000

// Mesma allowlist da migration (private.is_push_endpoint_allowed): o endpoint vem do cliente e o
// worker faz POST nele, então só os serviços de push dos navegadores são aceitos.
const PUSH_ENDPOINT_PATTERN =
  /^https:\/\/(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)\//i

const CONTENT = {
  post_like: ['Nova curtida', 'Alguém curtiu sua publicação.'],
  moderation_notice: ['Aviso da conta', 'Você recebeu um aviso da moderação.'],
  report_resolved: ['Atendimento', 'Seu caso foi analisado.'],
  economy_credit: ['Evolutus', 'Você recebeu uma recompensa.'],
  economy_debit: ['Ajuste na carteira', 'Houve um ajuste na sua carteira.'],
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

const MODERATION_BODIES = {
  warning: 'Você recebeu um aviso da moderação.',
  remove_content: 'Um conteúdo seu foi removido pela moderação.',
  temporary_suspension: 'Sua conta foi suspensa temporariamente.',
  community_ban: 'Você foi removido de uma comunidade.',
  system_ban: 'Sua conta foi suspensa.',
  restore: 'Uma restrição na sua conta foi retirada.',
}
const SUPPORT_BODIES = {
  report: 'Sua denúncia foi analisada.',
  appeal: 'Seu recurso foi analisado.',
  privacy: 'Sua solicitação de privacidade foi concluída.',
}
const ECONOMY_REASONS = { cash_purchase_confirmed: 'Pagamento confirmado', admin_bonus: 'Bônus' }
const ASSET_NAMES = { coin: 'EvoCoins', cash: 'EvoCash' }
const SOCIAL_TYPES = ['post_reply', 'comment_reply', 'comment_mention', 'comment_like', 'post_like']

const WORKOUT_REMINDERS = {
  workout_reminder_before: [
    ['🏋️ Treino no radar', 'Seu treino começa em uma hora. Deixe tudo pronto!'],
    ['🔥 O plano está de pé', 'Daqui a uma hora é hora de treinar. Bora?'],
    ['⚡ Já já tem treino', 'Falta uma hora para colocar o plano em prática.'],
    ['👀 Seu treino está chegando', 'Uma hora para começar. Seu plano está esperando.'],
    ['💪 Prepare o terreno', 'Seu horário de treino chega em uma hora.'],
    ['Treino marcado', 'Daqui a uma hora você tem um encontro com seu plano.'],
  ],
  workout_reminder_start: [
    ['🏋️ Hora de treinar!', 'Seu treino de hoje já está esperando.'],
    ['🔥 Vamos nessa?', 'Você marcou este horário por um motivo.'],
    ['⚡ Seu treino começou', 'O plano está feito. Agora é colocar em prática.'],
    ['👀 O treino está olhando pra você', 'Bora começar?'],
    ['💪 É agora', 'Seu horário de treino chegou.'],
    ['Seu plano chama', 'Hora de dar o primeiro passo do treino de hoje.'],
  ],
}

export function workoutReminderMessage(type, variant) {
  const messages = WORKOUT_REMINDERS[type]
  if (!messages) return null
  const index = Number.isInteger(variant) && variant >= 0 ? variant % messages.length : 0
  return messages[index]
}

// Texto do Push de economia. O valor vem da ledger confirmada no banco (metadata gravada pelo
// trigger), nunca do cliente. Só o valor de EvoCoins aparece: nada de saldo, e nenhum valor em
// EvoCash (informação financeira que pode ficar visível na tela bloqueada).
function economyContent(job, metadata) {
  const asset = ASSET_NAMES[metadata.asset] ? metadata.asset : null
  const reason = ECONOMY_REASONS[metadata.reason]
  if (job.notification_type === 'economy_debit') {
    return ['Ajuste na carteira', 'Houve um ajuste na sua carteira. Toque para ver.']
  }
  if (asset === 'coin') {
    const amount = Number(metadata.amount)
    if (Number.isFinite(amount) && amount > 0 && amount <= 1e9) {
      return ['Você recebeu EvoCoins', `Você recebeu ${amount.toLocaleString('pt-BR')} EvoCoins.${reason ? ` Motivo: ${reason}.` : ''}`]
    }
  }
  if (metadata.reason === 'cash_purchase_confirmed') return ['Pagamento confirmado', 'Seus EvoCash foram creditados.']
  return [asset === 'cash' ? 'Você recebeu EvoCash' : 'Você recebeu uma recompensa',
    asset === 'cash' ? 'Você recebeu EvoCash.' : 'Você recebeu uma recompensa.']
}

export function isAllowedPushEndpoint(value) {
  return typeof value === 'string' && value.length <= 4096 && PUSH_ENDPOINT_PATTERN.test(value)
}

export function safeTargetUrl(value) {
  // "\" é tratado como "/" pelos navegadores: "/\host" equivale a "//host".
  if (
    typeof value !== 'string' || value.length > 300 || !value.startsWith('/') ||
    value.startsWith('//') || value.includes('\\')
  ) {
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
  let title = broadcast && typeof metadata.title === 'string' ? metadata.title.slice(0, 120)
    : actor && SOCIAL_TYPES.includes(job.notification_type)
    ? `${actor}: ${fallbackTitle.toLowerCase()}`
    : fallbackTitle
  let finalBody = body
  if (job.notification_type === 'economy_credit' || job.notification_type === 'economy_debit') {
    ;[title, finalBody] = economyContent(job, metadata)
  } else if (WORKOUT_REMINDERS[job.notification_type]) {
    ;[title, finalBody] = workoutReminderMessage(job.notification_type, metadata.variant)
  } else if (job.notification_type === 'moderation_notice') {
    finalBody = MODERATION_BODIES[metadata.action] || body
  } else if (job.notification_type === 'report_resolved') {
    finalBody = SUPPORT_BODIES[metadata.kind] || body
  }
  return {
    notificationId: String(job.notification_id),
    title,
    body: finalBody,
    type: job.notification_type,
    targetUrl: safeTargetUrl(job.action_url),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  }
}

const URGENCIES = new Set(['very-low', 'low', 'normal', 'high'])

// Urgência e TTL vêm do catálogo do banco (uma linha por tipo). Valores inesperados caem em
// padrões seguros em vez de quebrar o envio.
export function pushSendOptions(job) {
  const ttl = Number(job.ttl_seconds)
  return {
    urgency: URGENCIES.has(job.urgency) ? job.urgency : 'normal',
    ttl: Number.isInteger(ttl) && ttl >= 60 && ttl <= 2419200 ? ttl : 86400,
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

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('PUSH_SEND_TIMEOUT'), { code: 'ETIMEDOUT' })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function processPushOutbox(admin, sendNotification, {
  workerId = crypto.randomUUID(), limit = DEFAULT_LIMIT, sendTimeoutMs = DEFAULT_SEND_TIMEOUT_MS,
} = {}) {
  const { data: jobs, error: claimError } = await admin.rpc('claim_push_jobs', {
    p_worker_id: workerId,
    p_limit: Math.min(Math.max(limit, 1), 100),
  })
  if (claimError) throw claimError

  const uniqueJobs = [...new Map((jobs || []).map((job) => [job.delivery_id, job])).values()]
  const results = await Promise.all(uniqueJobs.map(async (job) => {
    if (!isAllowedPushEndpoint(job.endpoint)) {
      // Nunca chama um host fora da allowlist; a subscription é revogada pelo outcome `expired`.
      return { delivery_id: job.delivery_id, outcome: 'expired', http_status: null, error: 'ENDPOINT_NOT_ALLOWED' }
    }
    try {
      await withTimeout(sendNotification(
        { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } },
        buildPushPayload(job),
        pushSendOptions(job)
      ), sendTimeoutMs)
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
