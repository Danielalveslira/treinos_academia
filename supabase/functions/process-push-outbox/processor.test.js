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

test('payload é mínimo e carrega só campos conhecidos (nada de metadata nem ids internos)', () => {
  const payload = buildPushPayload({
    notification_id: 5, notification_type: 'post_reply', actor_username: 'ana', action_url: '/comunidades/c/publicacoes/p/comentarios/k',
    metadata: { email: 'segredo@example.test', saldo: 999 }, variant: 3, group_count: 1,
  })
  assert.deepEqual(Object.keys(payload).sort(), ['badge', 'body', 'icon', 'notificationId', 'targetUrl', 'title', 'type'])
  assert.equal(JSON.stringify(payload).includes('segredo'), false)
  assert.equal(JSON.stringify(payload).includes('999'), false)
})

test('curtidas e alertas administrativos levam `tag` para substituir o Push anterior no aparelho', () => {
  const a = buildPushPayload({ notification_id: 1, notification_type: 'post_like', actor_username: 'a', action_url: '/comunidades/c#publicacao-p1', metadata: {}, variant: 0, group_count: 1 })
  const b = buildPushPayload({ notification_id: 2, notification_type: 'post_like', actor_username: 'b', action_url: '/comunidades/c#publicacao-p1', metadata: {}, variant: 1, group_count: 3 })
  const other = buildPushPayload({ notification_id: 3, notification_type: 'post_like', actor_username: 'c', action_url: '/comunidades/c#publicacao-p2', metadata: {}, variant: 0, group_count: 1 })
  assert.equal(a.tag, b.tag, 'mesma publicação, mesma tag')
  assert.notEqual(a.tag, other.tag, 'publicações diferentes não se substituem')
  assert.match(a.tag, /^post_like:[a-z0-9]+$/)
  assert.equal(buildPushPayload({ notification_id: 4, notification_type: 'post_reply', actor_username: 'a', action_url: '/x', metadata: {}, variant: 0, group_count: 1 }).tag, undefined, 'comentários nunca se substituem')
})

test('o worker repassa variante e tamanho do grupo ao texto (curtidas agrupadas)', () => {
  const payload = buildPushPayload({ notification_id: 9, notification_type: 'post_like', actor_username: 'joao', action_url: '/x', metadata: {}, variant: 0, group_count: 4 })
  assert.match(payload.body, /^@joao e mais 3 pessoas curtiram/)
  const same = buildPushPayload({ notification_id: 9, notification_type: 'post_like', actor_username: 'joao', action_url: '/x', metadata: {}, variant: 0, group_count: 4 })
  assert.deepEqual(payload, same, 'reprocessar o mesmo job gera exatamente o mesmo Push')
})

test('lembretes de treino usam a variante gravada pelo banco (sem módulo) e não expõem a data', () => {
  const base = { notification_id: 42, notification_type: 'workout_reminder_start', action_url: '/novo-treino?planejado=2026-10-06' }
  const a = buildPushPayload({ ...base, metadata: { variant: 9600 } })
  const b = buildPushPayload({ ...base, metadata: { variant: 9601 } })
  assert.notEqual(a.title, b.title)
  assert.equal(a.targetUrl, base.action_url)
  assert.equal(JSON.stringify(a).includes('2026-10-06'), true, 'a data só existe no deep link, nunca no texto')
  assert.equal(a.body.includes('2026'), false)
})

test('erros persistidos não carregam URLs, tokens longos nem as chaves da subscription', () => {
  const job = { endpoint: `${FCM}abc`, p256dh: 'chave-publica', auth: 'segredo-auth' }
  const raw = new Error(`falha em https://outro.exemplo/path?token=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef e chave-publica segredo-auth Bearer eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstuvwxyz`)
  const out = safePushError(raw, job)
  assert.ok(!/https?:|chave-publica|segredo-auth|eyJhbGci|ABCDEFGHIJKLMNOP/.test(out), out)
  assert.ok(out.length <= 500)
})

// ===== Telemetria da última milha =====
const TOKEN = 'ab'.repeat(32)
const telemetryJob = (id, extra = {}) => ({
  delivery_id: id, notification_id: 9, endpoint: `${FCM}secret-endpoint-${id}`, p256dh: 'p256-secret-value', auth: 'auth-secret-value',
  notification_type: 'comment_reply', action_url: '/x', ack_token: TOKEN, ...extra,
})
const fakeClock = (...instants) => {
  let index = 0
  return () => new Date(instants[Math.min(index++, instants.length - 1)])
}
function runWith(jobs, send, options = {}) {
  const captured = { payloads: [] }
  const admin = { rpc: async (name, args) => {
    if (name === 'claim_push_jobs') return { data: jobs, error: null }
    captured.results = args.p_results
    return { error: null }
  } }
  return processPushOutbox(admin, async (subscription, payload, sendOptions) => {
    captured.payloads.push(payload)
    return send(subscription, payload, sendOptions)
  }, { workerId: 'w', ...options }).then((summary) => ({ summary, ...captured }))
}

test('telemetria: o token da entrega vai no payload (criptografado pelo transporte) e nunca nos resultados', async () => {
  const { payloads, results } = await runWith([telemetryJob('d1')], async () => ({ statusCode: 201 }))
  assert.equal(payloads[0].ack, TOKEN)
  assert.equal(JSON.stringify(results).includes(TOKEN), false)
  assert.equal(JSON.stringify(results).includes('secret'), false)
})

test('telemetria: token ausente ou malformado não entra no payload e não impede o envio', async () => {
  for (const ack_token of [undefined, null, '', 'curto', 'AB'.repeat(32), `${TOKEN}x`, '<script>']) {
    const { payloads, summary } = await runWith([telemetryJob('d2', { ack_token })], async () => ({ statusCode: 201 }))
    assert.equal('ack' in payloads[0], false, String(ack_token))
    assert.equal(summary.sent, 1)
  }
})

test('telemetria: persiste o código HTTP REAL do Push Service, sem inventar', async () => {
  const statuses = { a: 201, b: 202, c: undefined }
  const { results } = await runWith(
    [telemetryJob('a'), telemetryJob('b'), telemetryJob('c')],
    async (subscription) => {
      const code = statuses[subscription.endpoint.slice(-1)]
      return code ? { statusCode: code } : undefined
    }
  )
  const byId = Object.fromEntries(results.map((item) => [item.delivery_id, item.http_status]))
  assert.deepEqual(byId, { a: 201, b: 202, c: null })
})

test('telemetria: falha do Push Service guarda o HTTP real da falha', async () => {
  const { results } = await runWith([telemetryJob('f')], async () => { throw Object.assign(new Error('boom'), { statusCode: 503 }) })
  assert.equal(results[0].outcome, 'transient')
  assert.equal(results[0].http_status, 503)
  assert.equal('provider_accepted_at' in results[0], false)
})

test('telemetria: worker_started_at é o início do ciclo e provider_accepted_at vem depois do envio', async () => {
  const { results } = await runWith(
    [telemetryJob('t')], async () => ({ statusCode: 201 }),
    { clock: fakeClock('2026-10-05T15:00:01.000Z', '2026-10-05T15:00:01.250Z') }
  )
  assert.equal(results[0].worker_started_at, '2026-10-05T15:00:01.000Z')
  assert.equal(results[0].provider_accepted_at, '2026-10-05T15:00:01.250Z')
})

test('telemetria: endpoint recusado e falhas carregam só o início do ciclo', async () => {
  const { results } = await runWith(
    [telemetryJob('bad', { endpoint: 'https://evil.test/push' })], async () => ({ statusCode: 201 }),
    { clock: fakeClock('2026-10-05T15:00:01.000Z') }
  )
  assert.equal(results[0].outcome, 'expired')
  assert.equal(results[0].worker_started_at, '2026-10-05T15:00:01.000Z')
  assert.equal('provider_accepted_at' in results[0], false)
})

test('telemetria: o token nunca vaza em mensagens de erro persistidas', () => {
  const message = safePushError(new Error(`falha com ${TOKEN} e ${FCM}secret-endpoint-d1`), telemetryJob('d1'))
  assert.equal(message.includes(TOKEN), false)
  assert.equal(message.includes('secret-endpoint'), false)
})

test('telemetria: não muda urgency, TTL nem o fluxo de envio', async () => {
  const seen = []
  const { summary } = await runWith(
    [telemetryJob('u', { urgency: 'high', ttl_seconds: 900 })],
    async (_subscription, _payload, sendOptions) => { seen.push(sendOptions); return { statusCode: 201 } }
  )
  assert.deepEqual(seen[0], { urgency: 'high', ttl: 900 })
  assert.deepEqual(summary, { claimed: 1, sent: 1, failed: 0 })
})
