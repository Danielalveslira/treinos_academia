import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerHandler, secretsMatch } from './handler.js'

const SECRET = 's'.repeat(40)

function request({ method = 'POST', secret } = {}) {
  const headers = new Headers()
  if (secret !== undefined) headers.set('X-Push-Worker-Secret', secret)
  return new Request('https://example.test/functions/v1/process-push-outbox', { method, headers })
}

function setup(overrides = {}) {
  const state = { runs: 0 }
  const handle = createWorkerHandler({
    workerSecret: SECRET,
    vapidReady: true,
    run: async () => { state.runs += 1; return { claimed: 0, sent: 0, failed: 0 } },
    ...overrides,
  })
  return { state, handle }
}

test('sem o header do segredo: 401 e a fila não é tocada', async () => {
  const { state, handle } = setup()
  const response = await handle(request())
  assert.equal(response.status, 401)
  assert.equal(state.runs, 0)
})

test('segredo incorreto, vazio ou de tamanho diferente: 401 e a fila não é tocada', async () => {
  const { state, handle } = setup()
  for (const secret of ['x'.repeat(40), '', SECRET.slice(1), `${SECRET}x`, 'Bearer ' + SECRET]) {
    assert.equal((await handle(request({ secret }))).status, 401)
  }
  assert.equal(state.runs, 0)
})

test('chave anon pública no Authorization não substitui o segredo', async () => {
  const { state, handle } = setup()
  const req = new Request('https://example.test/', { method: 'POST', headers: { Authorization: 'Bearer anon-key' } })
  assert.equal((await handle(req)).status, 401)
  assert.equal(state.runs, 0)
})

test('segredo correto processa a fila uma vez', async () => {
  const { state, handle } = setup()
  const response = await handle(request({ secret: SECRET }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { claimed: 0, sent: 0, failed: 0 })
  assert.equal(state.runs, 1)
})

test('método diferente de POST é recusado antes de tudo', async () => {
  const { state, handle } = setup()
  const response = await handle(new Request('https://example.test/', { method: 'GET', headers: { 'X-Push-Worker-Secret': SECRET } }))
  assert.equal(response.status, 405)
  assert.equal(state.runs, 0)
})

test('servidor sem segredo configurado ou curto demais: 503 e nada é processado', async () => {
  for (const workerSecret of [undefined, '', 'curto']) {
    const { state, handle } = setup({ workerSecret })
    assert.equal((await handle(request({ secret: workerSecret ?? '' }))).status, 503)
    assert.equal(state.runs, 0)
  }
})

test('sem VAPID: 503 sem consumir a fila, mesmo com segredo correto', async () => {
  const { state, handle } = setup({ vapidReady: false })
  assert.equal((await handle(request({ secret: SECRET }))).status, 503)
  assert.equal(state.runs, 0)
})

test('falha interna devolve 500 sem vazar a mensagem', async () => {
  const logged = []
  const { handle } = setup({
    run: async () => { throw Object.assign(new Error('boom https://fcm.googleapis.com/fcm/send/secret'), { code: 'X1' }) },
    logError: (...args) => logged.push(args),
  })
  const response = await handle(request({ secret: SECRET }))
  assert.equal(response.status, 500)
  assert.equal(JSON.stringify(await response.json()).includes('secret'), false)
  assert.equal(JSON.stringify(logged).includes('fcm.googleapis'), false)
})

test('secretsMatch compara valores iguais e diferentes', async () => {
  assert.equal(await secretsMatch(SECRET, SECRET), true)
  assert.equal(await secretsMatch(SECRET, `${SECRET}x`), false)
  assert.equal(await secretsMatch(null, SECRET), false)
})
