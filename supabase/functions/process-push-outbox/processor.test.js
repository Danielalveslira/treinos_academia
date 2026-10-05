import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPushPayload, classifyPushError, isAllowedPushEndpoint, processPushOutbox, pushSendOptions, safePushError, safeTargetUrl,
} from './processor.js'

const FCM = 'https://fcm.googleapis.com/fcm/send/'

test('safeTargetUrl rejeita URLs externas e esquemas executáveis', () => {
  assert.equal(safeTargetUrl('/comunidades/1'), '/comunidades/1')
  assert.equal(safeTargetUrl('//evil.test'), '/')
  assert.equal(safeTargetUrl('https://evil.test'), '/')
  assert.equal(safeTargetUrl('javascript:alert(1)'), '/')
  assert.equal(safeTargetUrl('/\\evil.test'), '/')
  assert.equal(safeTargetUrl('/ok\nx'), '/')
})

test('payload é mínimo e não replica metadata sensível', () => {
  const payload = buildPushPayload({ notification_id: 4, notification_type: 'comment_reply', action_url: '/x', metadata: { email: 'secret' } })
  assert.deepEqual(Object.keys(payload).sort(), ['badge', 'body', 'icon', 'notificationId', 'targetUrl', 'title', 'type'])
  assert.equal(JSON.stringify(payload).includes('secret'), false)
})

test('classifica expiração, rate limit, servidor, timeout e erro permanente', () => {
  assert.equal(classifyPushError({ statusCode: 404 }).outcome, 'expired')
  assert.equal(classifyPushError({ statusCode: 410 }).outcome, 'expired')
  assert.equal(classifyPushError({ statusCode: 429 }).outcome, 'transient')
  assert.equal(classifyPushError({ statusCode: 500 }).outcome, 'transient')
  assert.equal(classifyPushError(new Error('timeout')).outcome, 'transient')
  assert.equal(classifyPushError({ statusCode: 400 }).outcome, 'permanent')
})

test('erro persistido não contém endpoint nem chaves da subscription', () => {
  const job = { endpoint: `${FCM}secret`, p256dh: 'public-secret', auth: 'auth-secret' }
  const value = safePushError(new Error(`failed ${FCM}secret public-secret auth-secret`), job)
  assert.equal(value.includes('secret'), false)
  assert.match(value, /\[redacted\]/)
})

test('falha isolada não interrompe lote e resultados são finalizados juntos', async () => {
  const calls = []
  const admin = { rpc: async (name, args) => {
    calls.push([name, args])
    if (name === 'claim_push_jobs') return { data: [
      { delivery_id: 'a', notification_id: 1, endpoint: `${FCM}1`, p256dh: 'x', auth: 'y', notification_type: 'post_reply', action_url: '/a' },
      { delivery_id: 'b', notification_id: 2, endpoint: `${FCM}2`, p256dh: 'x', auth: 'y', notification_type: 'post_reply', action_url: '/b' },
    ], error: null }
    return { error: null }
  } }
  const result = await processPushOutbox(admin, async (subscription) => {
    if (subscription.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 })
  }, { workerId: 'worker', limit: 25 })
  assert.deepEqual(result, { claimed: 2, sent: 1, failed: 1 })
  assert.equal(calls[1][0], 'finish_push_batch')
  assert.deepEqual(calls[1][1].p_results.map((item) => item.outcome), ['sent', 'expired'])
})

test('delivery duplicada no retorno do claim é enviada uma única vez', async () => {
  let sends = 0
  let finalized
  const job = {
    delivery_id: 'same-delivery', notification_id: 3, endpoint: `${FCM}3`,
    p256dh: 'x', auth: 'y', notification_type: 'post_reply', action_url: '/',
  }
  const admin = { rpc: async (name, args) => {
    if (name === 'claim_push_jobs') return { data: [job, { ...job }], error: null }
    finalized = args.p_results
    return { error: null }
  } }
  const result = await processPushOutbox(admin, async () => { sends += 1 }, { workerId: 'worker' })
  assert.equal(sends, 1)
  assert.equal(finalized.length, 1)
  assert.equal(result.claimed, 1)
})

test('endpoint só aceita serviços de push conhecidos', () => {
  assert.equal(isAllowedPushEndpoint(`${FCM}abc`), true)
  assert.equal(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true)
  assert.equal(isAllowedPushEndpoint('https://web.push.apple.com/abc'), true)
  assert.equal(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc'), true)
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.test/abc'), false)
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com@evil.test/abc'), false)
  assert.equal(isAllowedPushEndpoint('http://fcm.googleapis.com/abc'), false)
  assert.equal(isAllowedPushEndpoint('https://169.254.169.254/latest'), false)
  assert.equal(isAllowedPushEndpoint(null), false)
})

test('endpoint fora da allowlist nunca é chamado e a subscription é expirada', async () => {
  let sends = 0
  let finalized
  const admin = { rpc: async (name, args) => {
    if (name === 'claim_push_jobs') return { data: [
      { delivery_id: 'ssrf', notification_id: 9, endpoint: 'https://internal.test/hook', p256dh: 'x', auth: 'y', notification_type: 'post_reply', action_url: '/' },
    ], error: null }
    finalized = args.p_results
    return { error: null }
  } }
  await processPushOutbox(admin, async () => { sends += 1 }, { workerId: 'worker' })
  assert.equal(sends, 0)
  assert.equal(finalized[0].outcome, 'expired')
  assert.equal(finalized[0].error, 'ENDPOINT_NOT_ALLOWED')
})

test('timeout do provedor vira falha transitória e não trava o lote', async () => {
  let finalized
  const admin = { rpc: async (name, args) => {
    if (name === 'claim_push_jobs') return { data: [
      { delivery_id: 'slow', notification_id: 1, endpoint: `${FCM}slow`, p256dh: 'x', auth: 'y', notification_type: 'post_reply', action_url: '/' },
      { delivery_id: 'fast', notification_id: 2, endpoint: `${FCM}fast`, p256dh: 'x', auth: 'y', notification_type: 'post_reply', action_url: '/' },
    ], error: null }
    finalized = args.p_results
    return { error: null }
  } }
  const result = await processPushOutbox(
    admin,
    (subscription) => (subscription.endpoint.endsWith('slow') ? new Promise(() => {}) : Promise.resolve()),
    { workerId: 'worker', sendTimeoutMs: 20 }
  )
  assert.deepEqual(finalized.map((item) => [item.delivery_id, item.outcome]), [['slow', 'transient'], ['fast', 'sent']])
  assert.deepEqual(result, { claimed: 2, sent: 1, failed: 1 })
})

test('falha de finalização propaga para o worker não marcar sucesso falso', async () => {
  const admin = { rpc: async (name) => {
    if (name === 'claim_push_jobs') return { data: [
      { delivery_id: 'a', notification_id: 1, endpoint: `${FCM}a`, p256dh: 'x', auth: 'y', notification_type: 'post_reply', action_url: '/' },
    ], error: null }
    return { error: new Error('db down') }
  } }
  await assert.rejects(processPushOutbox(admin, async () => {}, { workerId: 'worker' }), /db down/)
})

test('payload de broadcast usa título/corpo limitados e URL sanitizada', () => {
  const payload = buildPushPayload({
    notification_id: 1, notification_type: 'admin_broadcast', action_url: '/\\evil.test',
    metadata: { title: 'T'.repeat(500), body: 'B'.repeat(500), email: 'secret@example.test' },
  })
  assert.equal(payload.title.length, 120)
  assert.equal(payload.body.length, 240)
  assert.equal(payload.targetUrl, '/')
  assert.equal(JSON.stringify(payload).includes('secret@'), false)
})

test('payload de comment_like diz quem curtiu e abre o comentário, sem conteúdo privado', () => {
  const payload = buildPushPayload({
    notification_id: 41, notification_type: 'comment_like', actor_username: 'liker02',
    action_url: '/comunidades/c1/publicacoes/p1/comentarios/k1', metadata: { texto: 'privado' },
  })
  assert.equal(payload.title, '@liker02: nova curtida')
  assert.equal(payload.body, 'Alguém curtiu seu comentário.')
  assert.equal(payload.targetUrl, '/comunidades/c1/publicacoes/p1/comentarios/k1')
  assert.equal(JSON.stringify(payload).includes('privado'), false)
})

test('payloads dos novos eventos: post_like, economia, moderação e atendimento, sem dados sensíveis', () => {
  const like = buildPushPayload({ notification_id: 1, notification_type: 'post_like', actor_username: 'ana', action_url: '/comunidades/c#publicacao-p', metadata: {} })
  assert.equal(like.title, '@ana: nova curtida')
  assert.equal(like.body, 'Alguém curtiu sua publicação.')
  assert.equal(like.targetUrl, '/comunidades/c#publicacao-p')

  const coins = buildPushPayload({ notification_id: 2, notification_type: 'economy_credit', action_url: '/evocash', metadata: { asset: 'coin', amount: 25, reason: 'admin_bonus' } })
  assert.equal(coins.title, 'Você recebeu EvoCoins')
  assert.equal(coins.body, 'Você recebeu 25 EvoCoins. Motivo: Bônus.')

  const cash = buildPushPayload({ notification_id: 3, notification_type: 'economy_credit', action_url: '/evocash', metadata: { asset: 'cash', amount: 120, reason: 'cash_purchase_confirmed' } })
  assert.equal(cash.title, 'Pagamento confirmado')
  assert.equal(JSON.stringify(cash).includes('120'), false, 'valor em EvoCash não aparece no Push')

  const debit = buildPushPayload({ notification_id: 4, notification_type: 'economy_debit', action_url: '/evocash', metadata: { asset: 'coin', amount: 9876, reason: 'chargeback' } })
  assert.equal(JSON.stringify(debit).includes('9876'), false, 'ajuste não expõe valor')

  const mod = buildPushPayload({ notification_id: 5, notification_type: 'moderation_notice', action_url: '/atendimento', metadata: { action: 'remove_content', reason: 'SEGREDO' } })
  assert.equal(mod.body, 'Um conteúdo seu foi removido pela moderação.')
  assert.equal(JSON.stringify(mod).includes('SEGREDO'), false)

  const support = buildPushPayload({ notification_id: 6, notification_type: 'report_resolved', action_url: '/atendimento', metadata: { kind: 'appeal' } })
  assert.equal(support.body, 'Seu recurso foi analisado.')
})

test('valores inesperados nos metadados caem em texto genérico', () => {
  const weird = buildPushPayload({ notification_id: 7, notification_type: 'economy_credit', metadata: { asset: 'coin', amount: 'DROP TABLE', reason: '<script>' } })
  assert.equal(JSON.stringify(weird).includes('DROP'), false)
  assert.equal(JSON.stringify(weird).includes('script'), false)
  const unknownAction = buildPushPayload({ notification_id: 8, notification_type: 'moderation_notice', metadata: { action: '<b>x</b>' } })
  assert.equal(unknownAction.body, 'Você recebeu um aviso da moderação.')
})

test('urgência e TTL vêm do catálogo; valores inválidos usam padrões seguros', () => {
  assert.deepEqual(pushSendOptions({ urgency: 'high', ttl_seconds: 604800 }), { urgency: 'high', ttl: 604800 })
  assert.deepEqual(pushSendOptions({ urgency: 'normal', ttl_seconds: 86400 }), { urgency: 'normal', ttl: 86400 })
  assert.deepEqual(pushSendOptions({ urgency: 'urgentíssimo', ttl_seconds: -5 }), { urgency: 'normal', ttl: 86400 })
  assert.deepEqual(pushSendOptions({}), { urgency: 'normal', ttl: 86400 })
})

test('o worker repassa urgência/TTL de cada job ao provedor', async () => {
  const seen = []
  const admin = { rpc: async (name) => {
    if (name === 'claim_push_jobs') return { data: [
      { delivery_id: 'h', notification_id: 1, endpoint: `${FCM}h`, p256dh: 'x', auth: 'y', notification_type: 'post_reply', action_url: '/', urgency: 'high', ttl_seconds: 86400 },
      { delivery_id: 'n', notification_id: 2, endpoint: `${FCM}n`, p256dh: 'x', auth: 'y', notification_type: 'post_like', action_url: '/', urgency: 'normal', ttl_seconds: 3600 },
    ], error: null }
    return { error: null }
  } }
  await processPushOutbox(admin, async (subscription, payload, options) => { seen.push([subscription.endpoint.slice(-1), options]) }, { workerId: 'w' })
  assert.deepEqual(seen, [['h', { urgency: 'high', ttl: 86400 }], ['n', { urgency: 'normal', ttl: 3600 }]])
})
