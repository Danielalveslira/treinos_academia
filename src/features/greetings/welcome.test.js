import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acknowledgeWelcomeOnce, isWelcomeEligible } from './welcome.js'

const CUTOFF = Date.parse('2026-10-24T00:00:00-03:00')
const eligible = {
  createdAt: '2026-10-25T10:00:00Z',
  username: 'ana',
  accountStatus: 'active',
  welcomeSeenAt: null,
  cutoffMs: CUTOFF,
}

test('elegibilidade: só o conjunto completo de condições', () => {
  assert.equal(isWelcomeEligible(eligible), true)
  assert.equal(isWelcomeEligible({ ...eligible, welcomeSeenAt: '2026-10-25T11:00:00Z' }), false)
  assert.equal(isWelcomeEligible({ ...eligible, welcomeSeenAt: undefined }), false)
  assert.equal(isWelcomeEligible({ ...eligible, offlineLocal: true }), false)
  assert.equal(isWelcomeEligible({ ...eligible, cutoffMs: null }), false)
  assert.equal(isWelcomeEligible({ ...eligible, cutoffMs: Number.NaN }), false)
  assert.equal(isWelcomeEligible({ ...eligible, createdAt: '2026-10-23T00:00:00Z' }), false)
  assert.equal(isWelcomeEligible({ ...eligible, accountStatus: 'deleting' }), false)
  assert.equal(isWelcomeEligible({ ...eligible, username: '' }), false)
})

test('single-flight: chamadas simultâneas da mesma conta compartilham UMA requisição', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const send = async () => {
    calls += 1
    await gate
    return '2026-10-25T12:00:00Z'
  }
  const results = Promise.all([
    acknowledgeWelcomeOnce('u1', send),
    acknowledgeWelcomeOnce('u1', send),
    acknowledgeWelcomeOnce('u1', send),
  ])
  release()
  assert.deepEqual(await results, Array(3).fill('2026-10-25T12:00:00Z'))
  assert.equal(calls, 1)
})

test('single-flight: contas diferentes não se misturam e a chave é liberada ao terminar', async () => {
  const calls = []
  const sendFor = (id) => async () => {
    calls.push(id)
    return `seen-${id}`
  }
  const [a, b] = await Promise.all([
    acknowledgeWelcomeOnce('A', sendFor('A')),
    acknowledgeWelcomeOnce('B', sendFor('B')),
  ])
  assert.equal(a, 'seen-A')
  assert.equal(b, 'seen-B')
  await acknowledgeWelcomeOnce('A', sendFor('A2')) // nova entrada depois do fim: pode tentar de novo
  assert.deepEqual(calls, ['A', 'B', 'A2'])
})

test('falha libera a chave (sem retry em laço) e propaga o erro ao chamador', async () => {
  let calls = 0
  const failing = async () => {
    calls += 1
    throw new Error('offline')
  }
  await assert.rejects(acknowledgeWelcomeOnce('u2', failing), /offline/)
  assert.equal(calls, 1)
  await assert.rejects(acknowledgeWelcomeOnce('u2', failing), /offline/)
  assert.equal(calls, 2)
})

test('sem userId não há ACK', async () => {
  let called = false
  assert.equal(await acknowledgeWelcomeOnce(null, async () => (called = true)), null)
  assert.equal(called, false)
})
