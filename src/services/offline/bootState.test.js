import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BOOT_STATE,
  getBootState,
  resolveBootState,
  setBootState,
  subscribeBootState,
} from './bootState.js'

test('sem cold start no build (aqui não há import.meta.env) o boot começa resolvido: nada a esperar', () => {
  assert.equal(getBootState(), BOOT_STATE.onlineReady)
})

test('resolveBootState: carregando => initializing; cold start aberto => offline_ready', () => {
  assert.equal(resolveBootState({ loading: true, authMode: 'online' }), 'initializing')
  assert.equal(resolveBootState({ loading: true, authMode: 'offline-local' }), 'initializing')
  assert.equal(resolveBootState({ loading: false, authMode: 'offline-local', onLine: false }), 'offline_ready')
})

test('resolveBootState: terminou SEM cold start válido => offline_unavailable só quando realmente sem rede', () => {
  assert.equal(resolveBootState({ loading: false, authMode: 'online', onLine: false }), 'offline_unavailable')
  assert.equal(resolveBootState({ loading: false, authMode: 'online', onLine: true }), 'online_ready')
})

test('resolveBootState: restauração local negada não espera o auth-js (localDenied) e já é "indisponível"', () => {
  assert.equal(
    resolveBootState({ loading: true, authMode: 'online', localDenied: true, onLine: false }),
    'offline_unavailable'
  )
})

test('setBootState notifica só quando o estado muda e o cancelamento da assinatura funciona', () => {
  let calls = 0
  const stop = subscribeBootState(() => {
    calls += 1
  })
  const before = getBootState()
  setBootState(before)
  assert.equal(calls, 0)
  setBootState(BOOT_STATE.offlineReady)
  setBootState(BOOT_STATE.offlineReady)
  assert.equal(calls, 1)
  stop()
  setBootState(BOOT_STATE.initializing)
  assert.equal(calls, 1)
  setBootState(before)
})
