import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { closeDatabase, request, withTransaction } from './database.js'
import { DB_VERSION } from './schema.js'
import { queueOfflineTelemetry, safeTelemetryEvent, setOfflineTelemetryContext } from './telemetry.js'

const USER = 'd0000000-0000-4000-8000-000000000001'

test('eventos persistidos só contêm campos técnicos permitidos', async () => {
  setOfflineTelemetryContext(USER, false)
  assert.equal(await queueOfflineTelemetry('offline_write_created', {
    pending_count: 2, set_details: [{ weight: 100, reps: 10 }],
    email: 'secret@example.invalid', token: 'secret', note: 'private',
  }), true)
  const row = await withTransaction(['syncMeta'], 'readonly', ({ syncMeta }) =>
    request(syncMeta.get(`user:${USER}:offline-telemetry`)))
  assert.deepEqual(row.value[0], {
    event_type: 'offline_write_created', app_version: '1.0.0', schema_version: DB_VERSION,
    pending_count: 2,
  })
  assert.equal(await queueOfflineTelemetry('offline_write_created'), false) // limite local por tipo
  assert.equal(safeTelemetryEvent('unknown'), null)
  assert.equal(safeTelemetryEvent('sync_failed', { error_code: 'token=secret' }).error_code, undefined)
  await closeDatabase()
})

test('falha do storage de telemetria nunca rejeita a operação', async () => {
  const original = globalThis.indexedDB
  globalThis.indexedDB = undefined
  setOfflineTelemetryContext('d0000000-0000-4000-8000-000000000002', false)
  try {
    assert.equal(await queueOfflineTelemetry('sync_retry'), false)
  } finally {
    globalThis.indexedDB = original
    setOfflineTelemetryContext(null, false)
  }
})
