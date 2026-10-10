import { after, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// O relógio da frase: UM setTimeout até a próxima fronteira, sem polling, reavaliando ao voltar para o app.
let directory
let api
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'greeting-clock-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { useGreetingClock } from './useGreetingClock.js'
        export { act }
        function Probe({ preferences, enabled }) {
          const now = useGreetingClock({ preferences, enabled })
          globalThis.__nowSeen.push(now)
          return null
        }
        export function render(props) {
          let component
          act(() => { component = TestRenderer.create(createElement(Probe, props)) })
          return component
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
  })
  api = createRequire(import.meta.url)(outfile)
})
after(() => rm(directory, { recursive: true, force: true }))

let listeners
beforeEach(() => {
  listeners = new Map()
  const target = {
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((x) => x !== fn)
      ),
  }
  globalThis.window = { ...target }
  globalThis.document = { ...target, visibilityState: 'visible' }
  globalThis.__nowSeen = []
})
const count = () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0)
const distinct = () => new Set(globalThis.__nowSeen.map((d) => d.getTime())).size

test('agenda um único timeout e só renderiza de novo quando uma fronteira é cruzada', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-10T21:00:00-03:00') }) // 21:00 SP
  try {
    const component = api.render({ preferences: {}, enabled: true })
    const first = globalThis.__nowSeen.at(-1)
    // 2h59min depois ainda é o mesmo dia de negócio e o mesmo período: o `now` não é trocado
    api.act(() => mock.timers.tick(2 * 3_600_000 + 59 * 60_000))
    assert.equal(globalThis.__nowSeen.at(-1), first)
    // cruza a meia-noite de São Paulo: o `now` muda uma vez
    api.act(() => mock.timers.tick(2 * 60_000))
    const after = globalThis.__nowSeen.at(-1)
    assert.notEqual(after, first)
    assert.equal(after.toISOString().slice(0, 10), '2026-10-11')
    api.act(() => component.unmount())
  } finally {
    mock.timers.reset()
  }
})

test('voltar para o app (visibilitychange/pageshow) reavalia; desmontar remove tudo', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-10T12:00:00-03:00') })
  try {
    const component = api.render({ preferences: {}, enabled: true })
    assert.equal(count(), 2)
    mock.timers.setTime(new Date('2026-10-11T12:00:00-03:00').getTime())
    api.act(() => listeners.get('visibilitychange').forEach((fn) => fn()))
    assert.equal(globalThis.__nowSeen.at(-1).toISOString().slice(0, 10), '2026-10-11')
    api.act(() => component.unmount())
    assert.equal(count(), 0)
  } finally {
    mock.timers.reset()
  }
})

test('desabilitado: sem timer e sem listeners', () => {
  const component = api.render({ preferences: {}, enabled: false })
  assert.equal(count(), 0)
  api.act(() => component.unmount())
})

test('retomada com a aba oculta não faz nada', () => {
  const component = api.render({ preferences: {}, enabled: true })
  const before = distinct()
  globalThis.document.visibilityState = 'hidden'
  api.act(() => listeners.get('visibilitychange').forEach((fn) => fn()))
  assert.equal(distinct(), before)
  api.act(() => component.unmount())
})
