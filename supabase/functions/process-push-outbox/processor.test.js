import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPushPayload, classifyPushError, isAllowedPushEndpoint, processPushOutbox, safePushError, safeTargetUrl,
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
