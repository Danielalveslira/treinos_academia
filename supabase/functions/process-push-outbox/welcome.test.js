import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPushPayload, pushSendOptions, processPushOutbox } from './processor.js'
const FCM = 'https://fcm.googleapis.com/fcm/send/'

test('boas-vindas tem payload fixo, Home segura, ícones e TTL restante limitado', () => {
  const now = Date.parse('2026-10-14T12:00:00Z')
  const job = {
    notification_type: 'push_welcome',
    notification_id: 3,
    action_url: 'https://evil.test',
    ttl_seconds: 86400,
    metadata: { title: 'injetado', body: 'texto livre', expiresAt: '2026-10-14T12:05:00Z' },
  }
  const payload = buildPushPayload(job)
  assert.equal(payload.title, '💚 Boas-vindas ao Evolutus!')
  assert.equal(
    payload.body,
    'Obrigado por usar o Evolutus! As notificações estão ativadas neste dispositivo.'
  )
  assert.equal(payload.targetUrl, '/app')
  assert.equal(payload.icon, '/icons/icon-192.png')
  assert.equal(payload.badge, '/icons/icon-192.png')
  assert.deepEqual(pushSendOptions(job, now), { urgency: 'high', ttl: 300 })
  assert.equal(
    pushSendOptions({ ...job, metadata: { expiresAt: '2026-10-15T12:00:00Z' } }, now).ttl,
    600
  )
  assert.equal(
    pushSendOptions({ ...job, metadata: { expiresAt: '2026-10-14T12:00:10Z' } }, now).ttl,
    10
  )
})

test('boas-vindas expirada ou sem prazo nunca vai ao provedor nem vira TTL de 24h', async () => {
  let sent = 0
  let results
  const admin = {
    rpc: async (name, args) => {
      if (name === 'claim_push_jobs')
        return {
          data: [
            {
              delivery_id: 'expired',
              notification_type: 'push_welcome',
              endpoint: FCM + 'x',
              metadata: { expiresAt: '2026-10-13T00:00:00Z' },
            },
            {
              delivery_id: 'invalid',
              notification_type: 'push_welcome',
              endpoint: FCM + 'y',
              metadata: {},
            },
          ],
          error: null,
        }
      results = args.p_results
      return { error: null }
    },
  }
  await processPushOutbox(
    admin,
    async () => {
      sent++
    },
    { workerId: 'welcome', clock: () => new Date('2026-10-14T12:00:00Z') }
  )
  assert.equal(sent, 0)
  assert.deepEqual(
    results.map((x) => [x.outcome, x.error]),
    [
      ['permanent', 'WELCOME_EXPIRED'],
      ['permanent', 'WELCOME_EXPIRED'],
    ]
  )
})
