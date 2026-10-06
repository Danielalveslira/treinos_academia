import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { closeDatabase, isOfflineColdStartEnabled, isOfflineShellEnabled, isOfflineWriteEnabled, withTransaction } from './database.js'
import { hydrateOfflineRollout, isInOfflineRollout, refreshRemoteRollout, remoteFeatureAllowed, rolloutBucket, setOfflineRolloutUser, setRemoteRolloutSnapshot, validateRolloutSnapshot } from './rollout.js'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const env = { PROD: true, VITE_OFFLINE_WRITE_ENABLED: 'true', VITE_OFFLINE_COLD_START_ENABLED: 'true' }
const config = (write, cold = write) => ({
  offline_write: { enabled: true, rollout_percentage: write },
  offline_cold_start: { enabled: true, rollout_percentage: cold },
})

test('produção falha fechada: sem resposta remota, VITE percentual não libera ninguém', () => {
  setOfflineRolloutUser(A)
  assert.equal(isOfflineWriteEnabled({ ...env, VITE_OFFLINE_WRITE_ROLLOUT_PERCENT: '100' }), false)
  assert.equal(isOfflineColdStartEnabled(env, A), false)
  assert.equal(isOfflineColdStartEnabled(env), true) // só permite procurar bootstrap/cache
  assert.equal(isOfflineShellEnabled(env), false)
  setOfflineRolloutUser(null)
})

test('0%, 5%, 100% e bucket determinístico por usuário', () => {
  const low = Array.from({ length: 3000 }, (_, i) => `test-${i}`).find((id) => rolloutBucket(id) < 500)
  const high = Array.from({ length: 3000 }, (_, i) => `test-${i}`).find((id) => rolloutBucket(id) >= 500)
  assert.ok(low && high)
  assert.equal(isInOfflineRollout(low, 0), false)
  assert.equal(isInOfflineRollout(low, 5), true)
  assert.equal(isInOfflineRollout(high, 5), false)
  assert.equal(isInOfflineRollout(high, 100), true)
  assert.equal(rolloutBucket(low), rolloutBucket(low))
  assert.equal(isInOfflineRollout(null, 100), false)
  assert.equal(isInOfflineRollout(low, ''), false)
})

test('resposta remota válida controla flags, kill switch e contas separadas', () => {
  setOfflineRolloutUser(A)
  assert.equal(setRemoteRolloutSnapshot(A, config(100, 0)), true)
  assert.equal(isOfflineWriteEnabled(env), true)
  assert.equal(isOfflineColdStartEnabled(env, A), false)
  assert.equal(isOfflineShellEnabled(env), true)
  assert.equal(setRemoteRolloutSnapshot(B, config(100)), true)
  setOfflineRolloutUser(B)
  assert.equal(isOfflineWriteEnabled(env), true)
  setOfflineRolloutUser(A)
  assert.equal(setRemoteRolloutSnapshot(A, { ...config(100), offline_write: { enabled: false, rollout_percentage: 100 } }), true)
  assert.equal(isOfflineWriteEnabled(env), false)
  assert.equal(remoteFeatureAllowed(B, 'offline_write'), true)
  assert.equal(setRemoteRolloutSnapshot(A, { offline_write: { enabled: true, rollout_percentage: 100 } }), true)
  assert.equal(isOfflineColdStartEnabled(env, A), false) // ausente = 0
  assert.equal(setRemoteRolloutSnapshot(A, { offline_write: { enabled: 'yes', rollout_percentage: 100 } }), false)
  setOfflineRolloutUser(null)
})

test('cache local da última resposta válida funciona sem RPC; nunca cria permissão inédita', async () => {
  await withTransaction(['syncMeta'], 'readwrite', ({ syncMeta }) => {
    syncMeta.put({ key: `user:${C}:offline-rollout`, value: config(5, 100) })
  })
  assert.equal(await hydrateOfflineRollout(C) !== null, true)
  assert.equal(remoteFeatureAllowed(C, 'offline_cold_start'), true)
  assert.equal(remoteFeatureAllowed('never-seen', 'offline_cold_start'), false)
  assert.equal(validateRolloutSnapshot({ offline_write: { enabled: true } }).offline_write.rollout_percentage, 0)
  await closeDatabase()
})

test('RPC autenticada atualiza cache; falha remota mantém última decisão válida', async () => {
  const client = {
    rpc: async () => ({ data: config(100, 100), error: null }),
    auth: { getSession: async () => ({ data: { session: { user: { id: D } } } }) },
  }
  assert.equal(await refreshRemoteRollout(D, client), true)
  assert.equal(remoteFeatureAllowed(D, 'offline_write'), true)
  const cached = await withTransaction(['syncMeta'], 'readonly', ({ syncMeta }) =>
    new Promise((resolve, reject) => {
      const query = syncMeta.get(`user:${D}:offline-rollout`)
      query.onsuccess = () => resolve(query.result?.value)
      query.onerror = () => reject(query.error)
    }))
  assert.equal(cached.offline_write.rollout_percentage, 100)
  assert.equal(await refreshRemoteRollout(D, { ...client, rpc: async () => ({ data: null, error: Error('network') }) }), false)
  assert.equal(remoteFeatureAllowed(D, 'offline_write'), true)
  assert.equal(await refreshRemoteRollout('new-user', client), false) // sessão D não libera outra conta
  assert.equal(remoteFeatureAllowed('unknown', 'offline_write'), false)
  await closeDatabase()
})

test('cache antigo de outra aba não reativa feature já desligada pelo servidor', async () => {
  const old = {
    offline_write: { enabled: true, rollout_percentage: 100, updated_at: '2026-10-05T10:00:00Z' },
    offline_cold_start: { enabled: false, rollout_percentage: 0, updated_at: '2026-10-05T10:00:00Z' },
  }
  setRemoteRolloutSnapshot(E, old)
  await withTransaction(['syncMeta'], 'readwrite', ({ syncMeta }) => {
    syncMeta.put({ key: `user:${E}:offline-rollout`, value: old })
  })
  setRemoteRolloutSnapshot(E, {
    ...old, offline_write: { enabled: false, rollout_percentage: 0, updated_at: '2026-10-06T10:00:00Z' },
  })
  await hydrateOfflineRollout(E, { force: true })
  assert.equal(remoteFeatureAllowed(E, 'offline_write'), false)
  await closeDatabase()
})
