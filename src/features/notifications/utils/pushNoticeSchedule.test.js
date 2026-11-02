import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dismissPushNotice,
  nextNoticeAt,
  noticeKey,
  readPushNotice,
  NOTICE_COOLDOWN,
} from './pushNoticeSchedule.js'
const at = (text) => Date.parse(text)
function storage() {
  const data = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => data.get(key),
      setItem: (key, value) => data.set(key, value),
    },
  })
  return data
}

test('primeira visita é elegível; X persiste somente dia e timestamp, nunca dados Push', () => {
  storage()
  const key = noticeKey('first', false)
  const now = at('2026-10-14T18:00:00Z')
  assert.equal(nextNoticeAt(readPushNotice(key), now), now)
  const record = dismissPushNotice(key, now)
  assert.deepEqual(Object.keys(record), ['day', 'at', 'count'])
  assert.ok(nextNoticeAt(readPushNotice(key), now) > now)
  assert.deepEqual(readPushNotice(key), record)
})

test('F5/remount no mesmo dia não reapresenta, mesmo depois de 12h', () => {
  storage()
  const key = noticeKey('same-day', false)
  dismissPushNotice(key, at('2026-10-14T03:01:00Z'))
  const now = at('2026-10-15T02:59:00Z')
  assert.ok(nextNoticeAt(readPushNotice(key), now) > now)
})

test('virada às 03h UTC respeita mínimo real de 12 horas', () => {
  storage()
  const now = at('2026-10-15T02:59:00Z')
  const record = dismissPushNotice(noticeKey('midnight', false), now)
  assert.equal(record.day, '2026-10-14')
  assert.ok(nextNoticeAt(record, now + 120000) > now + 120000)
  assert.equal(nextNoticeAt(record), now + NOTICE_COOLDOWN)
  assert.equal(nextNoticeAt(record), at('2026-10-15T14:59:00Z'))
})

test('se 12h passaram antes da virada, aguarda o próximo dia de São Paulo', () => {
  storage()
  const record = dismissPushNotice(noticeKey('early', false), at('2026-10-14T08:00:00Z'))
  assert.equal(nextNoticeAt(record), at('2026-10-15T03:00:00Z'))
})

test('isolamento por usuário e contexto instalado/web', () => {
  storage()
  dismissPushNotice(noticeKey('A', false))
  assert.equal(readPushNotice(noticeKey('B', false)), null)
  assert.equal(readPushNotice(noticeKey('A', true)), null)
})

test('storage bloqueado mantém dispensa em memória na sessão', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked')
    },
  })
  const key = noticeKey('blocked', false)
  const record = dismissPushNotice(key)
  assert.deepEqual(readPushNotice(key), record)
})

test('JSON corrompido, timestamps inválidos e dia inconsistente são reparados uma vez', () => {
  const data = storage()
  for (const raw of ['oops', 'null', '{"at":-1}', '{"at":1e100}', '{"at":1,"day":"2026-10-14"}']) {
    const key = noticeKey(raw, false)
    data.set(key, raw)
    const record = readPushNotice(key)
    assert.ok(nextNoticeAt(record) > Date.now())
    assert.deepEqual(readPushNotice(key), record)
  }
})

test('relógio regressivo conserva a dispensa; outra aba lê gravação mais recente', () => {
  storage()
  const key = noticeKey('tabs', false)
  const now = at('2026-10-14T18:00:00Z')
  const record = dismissPushNotice(key, now)
  assert.ok(nextNoticeAt(record, now - NOTICE_COOLDOWN) > now - NOTICE_COOLDOWN)
  const next = dismissPushNotice(key, now + NOTICE_COOLDOWN)
  assert.deepEqual(readPushNotice(key), next)
})

test('dispensas repetidas recuam: próximo dia, depois 7 e 30 dias', () => {
  storage()
  const key = noticeKey('backoff', false)
  const first = dismissPushNotice(key, at('2026-10-14T18:00:00Z'))
  assert.equal(first.count, 1)
  assert.equal(nextNoticeAt(first), at('2026-10-15T06:00:00Z'))
  const second = dismissPushNotice(key, at('2026-10-16T18:00:00Z'))
  assert.equal(second.count, 2)
  assert.equal(nextNoticeAt(second), at('2026-10-23T18:00:00Z'))
  const third = dismissPushNotice(key, at('2026-10-24T18:00:00Z'))
  assert.equal(nextNoticeAt(third), at('2026-11-23T18:00:00Z'))
  assert.deepEqual(readPushNotice(key), third, 'contagem persiste entre leituras')
})
