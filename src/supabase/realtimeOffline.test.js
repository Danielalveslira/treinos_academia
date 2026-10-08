import test from 'node:test'
import assert from 'node:assert/strict'
import { pauseRealtimeWhenOffline } from './realtimeOffline.js'

function setup({ onLine = true, channels = 1 } = {}) {
  const calls = { connect: 0, disconnect: 0 }
  const client = {
    realtime: {
      channels: Array.from({ length: channels }, (_, i) => ({ topic: `c${i}` })),
      connect: () => { calls.connect += 1 },
      disconnect: async () => { calls.disconnect += 1 },
    },
  }
  const target = new EventTarget()
  target.navigator = { onLine }
  return { client, target, calls }
}

test('offline: desliga o socket uma vez e novos subscribe() não o reabrem', () => {
  const { client, target, calls } = setup()
  pauseRealtimeWhenOffline(client, target)
  target.navigator.onLine = false
  target.dispatchEvent(new Event('offline'))
  assert.equal(calls.disconnect, 1)
  client.realtime.connect() // o que channel.subscribe() faz internamente
  client.realtime.connect()
  assert.equal(calls.connect, 0, 'nenhuma tentativa de WebSocket sem rede')
})

test('ao voltar a rede reconecta (canais registrados reentram) e a conexão volta a ser permitida', () => {
  const { client, target, calls } = setup()
  pauseRealtimeWhenOffline(client, target)
  target.navigator.onLine = false
  target.dispatchEvent(new Event('offline'))
  target.navigator.onLine = true
  target.dispatchEvent(new Event('online'))
  assert.equal(calls.connect, 1)
  client.realtime.connect()
  assert.equal(calls.connect, 2)
})

test('ao voltar a rede sem canais não abre um socket à toa', () => {
  const { client, target, calls } = setup({ channels: 0 })
  pauseRealtimeWhenOffline(client, target)
  target.navigator.onLine = false
  target.dispatchEvent(new Event('offline'))
  target.navigator.onLine = true
  target.dispatchEvent(new Event('online'))
  assert.equal(calls.connect, 0)
})

test('já começa offline: desliga na hora; instalar duas vezes não duplica; stop restaura', () => {
  const { client, target, calls } = setup({ onLine: false })
  const original = client.realtime.connect
  const stop = pauseRealtimeWhenOffline(client, target)
  pauseRealtimeWhenOffline(client, target)
  assert.equal(calls.disconnect, 1)
  stop()
  assert.equal(client.realtime.connect, original)
  target.dispatchEvent(new Event('offline'))
  assert.equal(calls.disconnect, 1, 'listeners removidos')
})

test('cliente sem realtime e disconnect que lança não quebram', () => {
  assert.doesNotThrow(() => pauseRealtimeWhenOffline({}, new EventTarget())())
  const { client, target } = setup()
  client.realtime.disconnect = () => { throw new Error('socket fechado') }
  pauseRealtimeWhenOffline(client, target)
  target.navigator.onLine = false
  assert.doesNotThrow(() => target.dispatchEvent(new Event('offline')))
})
