import test from 'node:test'
import assert from 'node:assert/strict'
import { processCashPurchaseReminders } from './processor.js'

function job(overrides = {}) {
  return {
    id: 'job-1', purchase_id: 'purchase-1', user_id: 'user-1',
    username: 'josea', email: 'josea@example.test',
    package_label: 'Max', cash_amount: 300, amount_centavos: 4990, currency: 'BRL',
    purchase_created_at: '2026-10-15T12:56:00Z', attempt_count: 0,
    ...overrides,
  }
}

function adminWith(jobs) {
  const calls = []
  return {
    calls,
    client: {
      rpc: async (name, args) => {
        calls.push([name, args])
        if (name === 'claim_cash_purchase_reminder_jobs') return { data: jobs, error: null }
        return { data: null, error: null }
      },
    },
  }
}

test('envio com sucesso marca sent e chama o Resend com from/to/subject corretos', async () => {
  const { client, calls } = adminWith([job()])
  const fetchCalls = []
  const fetcher = async (url, options) => {
    fetchCalls.push([url, JSON.parse(options.body)])
    return { ok: true, status: 200 }
  }
  const result = await processCashPurchaseReminders(client, {
    workerId: 'worker', resendApiKey: 'key', fromAddress: 'Evolutus <no-reply@evolutus.app>',
    supportEmail: 'suporte@evolutus.app', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.deepEqual(result, { claimed: 1, sent: 1, retried: 0, failed: 0 })
  assert.equal(fetchCalls[0][1].to, 'josea@example.test')
  assert.equal(fetchCalls[0][1].from, 'Evolutus <no-reply@evolutus.app>')
  assert.match(fetchCalls[0][1].subject, /300 EvoCash/)
  assert.equal(calls[1][0], 'finish_cash_purchase_reminder_batch')
  assert.deepEqual(calls[1][1].p_results, [{ id: 'job-1', outcome: 'sent' }])
})

test('toda chamada ao Resend leva Idempotency-Key = id da linha da fila', async () => {
  const { client } = adminWith([job({ id: 'job-xyz' })])
  const fetchCalls = []
  const fetcher = async (url, options) => {
    fetchCalls.push(options.headers)
    return { ok: true, status: 200 }
  }
  await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.equal(fetchCalls[0]['Idempotency-Key'], 'job-xyz')
})

test('reenvio por timeout reusa a MESMA Idempotency-Key -- precondição para o Resend nunca duplicar o envio', async () => {
  // Mesma linha (job-1) reclamada em dois ciclos do cron: 1º timeout (vira retry, volta
  // pending), 2º ciclo reclama a MESMA linha de novo (claim_cash_purchase_reminder_jobs
  // nunca troca o id). O Resend guarda a chave por 24h e devolve a resposta original em vez
  // de enviar de novo (docs: resend.com/docs/api-reference/idempotency-keys) -- aqui só
  // provamos o que está do nosso lado: a chave enviada é idêntica nas duas tentativas.
  const keysSent = []
  const timeoutThenOk = async (url, options) => {
    keysSent.push(options.headers['Idempotency-Key'])
    if (keysSent.length === 1) return new Promise(() => {}) // never resolves -> timeout
    return { ok: true, status: 200 }
  }
  const { client: firstAttempt } = adminWith([job({ attempt_count: 0 })])
  const result1 = await processCashPurchaseReminders(firstAttempt, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app',
    fetcher: timeoutThenOk, sendTimeoutMs: 5,
  })
  assert.deepEqual(result1, { claimed: 1, sent: 0, retried: 1, failed: 0 })

  const { client: secondAttempt } = adminWith([job({ attempt_count: 1 })])
  const result2 = await processCashPurchaseReminders(secondAttempt, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app',
    fetcher: timeoutThenOk, sendTimeoutMs: 5,
  })
  assert.deepEqual(result2, { claimed: 1, sent: 1, retried: 0, failed: 0 })
  assert.deepEqual(keysSent, ['job-1', 'job-1'], 'as duas tentativas enviam a mesma Idempotency-Key')
})

test('409 concurrent_idempotent_requests (outra tentativa com a mesma chave ainda em voo) é transitório: retry', async () => {
  const { client, calls } = adminWith([job({ attempt_count: 0 })])
  const fetcher = async () => ({
    ok: false, status: 409, json: async () => ({ name: 'concurrent_idempotent_requests', message: 'in progress' }),
  })
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 1, failed: 0 })
  assert.equal(calls.at(-1)[1].p_results[0].error, 'RESEND_HTTP_409_concurrent_idempotent_requests')
})

test('409 concurrent_idempotent_requests esgotando as tentativas falha definitivamente (nunca trava reenviando para sempre)', async () => {
  const { client, calls } = adminWith([job({ attempt_count: 5 })])
  const fetcher = async () => ({
    ok: false, status: 409, json: async () => ({ name: 'concurrent_idempotent_requests' }),
  })
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 0, failed: 1 })
  assert.equal(calls.at(-1)[1].p_results[0].outcome, 'failed')
})

test('409 invalid_idempotent_request (mesma chave, payload diferente) é falha definitiva mesmo na 1a tentativa -- nunca reentar um bug real', async () => {
  const { client, calls } = adminWith([job({ attempt_count: 0 })])
  let fetchCount = 0
  const fetcher = async () => {
    fetchCount += 1
    return { ok: false, status: 409, json: async () => ({ name: 'invalid_idempotent_request', message: 'body modified' }) }
  }
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 0, failed: 1 })
  assert.equal(fetchCount, 1)
  assert.equal(calls.at(-1)[1].p_results[0].error, 'RESEND_HTTP_409_invalid_idempotent_request')
})

test('400 invalid_idempotency_key é falha definitiva mesmo na 1a tentativa', async () => {
  const { client, calls } = adminWith([job({ attempt_count: 0 })])
  const fetcher = async () => ({
    ok: false, status: 400, json: async () => ({ name: 'invalid_idempotency_key' }),
  })
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 0, failed: 1 })
  assert.equal(calls.at(-1)[1].p_results[0].error, 'RESEND_HTTP_400_invalid_idempotency_key')
})

test('409 sem corpo JSON reconhecível (tipo desconhecido) ainda é tratado como transitório por padrão', async () => {
  const { client, calls } = adminWith([job({ attempt_count: 0 })])
  const fetcher = async () => ({ ok: false, status: 409, json: async () => { throw new Error('not json') } })
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 1, failed: 0 })
  assert.equal(calls.at(-1)[1].p_results[0].error, 'RESEND_HTTP_409')
})

test('erro 5xx do provedor dentro do limite de tentativas volta para pending (retry)', async () => {
  const { client, calls } = adminWith([job({ attempt_count: 1 })])
  const fetcher = async () => ({ ok: false, status: 502, json: async () => ({}) })
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 1, failed: 0 })
  assert.equal(calls.at(-1)[1].p_results[0].outcome, 'retry')
})

test('erro 5xx após esgotar as tentativas falha definitivamente', async () => {
  const { client, calls } = adminWith([job({ attempt_count: 5 })])
  const fetcher = async () => ({ ok: false, status: 500, json: async () => ({}) })
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 0, failed: 1 })
  assert.equal(calls.at(-1)[1].p_results[0].outcome, 'failed')
})

test('erro 4xx do provedor falha sem reentar, mesmo na primeira tentativa', async () => {
  const { client } = adminWith([job({ attempt_count: 0 })])
  const fetcher = async () => ({ ok: false, status: 422, json: async () => ({}) })
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 0, failed: 1 })
})

test('destinatário sem e-mail resolvido (conta excluída entre o enfileiramento e o claim) falha sem chamar o Resend', async () => {
  const { client } = adminWith([job({ email: null, username: null })])
  let fetchCalled = false
  const fetcher = async () => { fetchCalled = true; return { ok: true, status: 200 } }
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.equal(fetchCalled, false)
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 0, failed: 1 })
})

test('timeout de rede é tratado como falha transitória (retry dentro do limite)', async () => {
  const { client, calls } = adminWith([job({ attempt_count: 0 })])
  const fetcher = () => new Promise(() => {}) // never resolves
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher, sendTimeoutMs: 5,
  })
  assert.deepEqual(result, { claimed: 1, sent: 0, retried: 1, failed: 0 })
  assert.equal(calls.at(-1)[1].p_results[0].error, 'EMAIL_SEND_TIMEOUT')
})

test('erro persistido nunca contém o e-mail do destinatário', async () => {
  const { client, calls } = adminWith([job({ attempt_count: 5 })])
  const fetcher = async () => { throw new Error('connection reset talking to josea@example.test') }
  await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher,
  })
  assert.equal(calls.at(-1)[1].p_results[0].error.includes('josea@example.test'), false)
})

test('lote vazio não chama finish_cash_purchase_reminder_batch', async () => {
  const { client, calls } = adminWith([])
  const result = await processCashPurchaseReminders(client, {
    resendApiKey: 'key', fromAddress: 'f', supportEmail: 's@e.test', appUrl: 'https://evolutus.app', fetcher: async () => ({ ok: true, status: 200 }),
  })
  assert.deepEqual(result, { claimed: 0, sent: 0, retried: 0, failed: 0 })
  assert.equal(calls.length, 1)
})
