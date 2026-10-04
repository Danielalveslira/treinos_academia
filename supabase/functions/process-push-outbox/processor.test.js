import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPushPayload, classifyPushError, processPushOutbox, safePushError, safeTargetUrl } from './processor.js'

test('safeTargetUrl rejeita URLs externas e esquemas executáveis', () => {
  assert.equal(safeTargetUrl('/comunidades/1'), '/comunidades/1')
  assert.equal(safeTargetUrl('//evil.test'), '/')
  assert.equal(safeTargetUrl('https://evil.test'), '/')
  assert.equal(safeTargetUrl('javascript:alert(1)'), '/')
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
  const job = { endpoint: 'https://push/secret', p256dh: 'public-secret', auth: 'auth-secret' }
  const value = safePushError(new Error('failed https://push/secret public-secret auth-secret'), job)
  assert.equal(value.includes('secret'), false)
  assert.match(value, /\[redacted\]/)
})

test('falha isolada não interrompe lote e resultados são finalizados juntos', async () => {
  const calls = []
  const admin = { rpc: async (name, args) => {
    calls.push([name, args])
    if (name === 'claim_push_jobs') return { data: [
      { delivery_id: 'a', notification_id: 1, endpoint: 'https://push/1', p256dh: 'x', auth: 'y', notification_type: 'post_reply', action_url: '/a' },
      { delivery_id: 'b', notification_id: 2, endpoint: 'https://push/2', p256dh: 'x', auth: 'y', notification_type: 'post_reply', action_url: '/b' },
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
    delivery_id: 'same-delivery', notification_id: 3, endpoint: 'https://push/3',
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
