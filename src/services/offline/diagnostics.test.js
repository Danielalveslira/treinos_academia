import test from 'node:test'
import assert from 'node:assert/strict'
import { getOfflineDiagnostics, recordOfflineDiagnostic } from './diagnostics.js'

test('diagnóstico rejeita dados arbitrários e expõe apenas contagens de eventos permitidos', () => {
  const before = getOfflineDiagnostics()
  assert.equal(recordOfflineDiagnostic('sync_retry'), true)
  assert.equal(recordOfflineDiagnostic('user_id=secret'), false)
  assert.equal(recordOfflineDiagnostic('sync_retry?token=secret'), false)
  const after = getOfflineDiagnostics()
  assert.equal(after.counters.sync_retry, (before.counters.sync_retry ?? 0) + 1)
  assert.equal(JSON.stringify(after).includes('secret'), false)
  after.counters.sync_retry = 999
  assert.notEqual(getOfflineDiagnostics().counters.sync_retry, 999)
})
