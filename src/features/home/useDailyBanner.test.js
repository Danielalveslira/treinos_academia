import { after, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// A foto do painel muda na virada do dia de negócio: UM setTimeout até a próxima fronteira, sem
// polling, reavaliando ao voltar para o app -- mesmo mecanismo de useGreetingClock.test.js.
let directory
let api
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'daily-banner-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { useDailyBanner } from './useDailyBanner.js'
        export { act }
        const PHOTOS = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
        function Probe() {
          const photo = useDailyBanner(PHOTOS)
          globalThis.__seen.push(photo)
          return null
        }
        export function render() {
          let component
          act(() => { component = TestRenderer.create(createElement(Probe)) })
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
  globalThis.__seen = []
})

test('mesma foto o dia inteiro; atualizar a página não troca antes da virada', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-25T10:00:00-03:00') })
  try {
    const component = api.render()
    const first = globalThis.__seen.at(-1)
    api.act(() => mock.timers.tick(13 * 3_600_000)) // 23:00 SP, ainda dia 25
    assert.deepEqual(globalThis.__seen.at(-1), first)
    api.act(() => component.unmount())
  } finally {
    mock.timers.reset()
  }
})

test('troca sozinha ao cruzar a meia-noite de São Paulo, sem polling', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-25T23:59:00-03:00') })
  try {
    const component = api.render()
    const before = globalThis.__seen.at(-1)
    api.act(() => mock.timers.tick(2 * 60_000)) // cruza para 00:01 SP do dia 26
    const after = globalThis.__seen.at(-1)
    assert.notEqual(after.name, before.name)
    api.act(() => component.unmount())
  } finally {
    mock.timers.reset()
  }
})

test('mesma rotação em dois dias seguidos: round-robin determinístico, não aleatório', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-25T12:00:00-03:00') })
  try {
    const first = api.render()
    const day1 = globalThis.__seen.at(-1)
    api.act(() => first.unmount())
    globalThis.__seen = []
    mock.timers.setTime(new Date('2026-10-25T12:00:01-03:00').getTime())
    const again = api.render()
    assert.deepEqual(globalThis.__seen.at(-1), day1)
    api.act(() => again.unmount())
  } finally {
    mock.timers.reset()
  }
})

test('voltar para o app (visibilitychange/pageshow) reavalia; desmontar remove os listeners', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-25T12:00:00-03:00') })
  try {
    const component = api.render()
    const countListeners = () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0)
    assert.equal(countListeners(), 2)
    mock.timers.setTime(new Date('2026-10-26T12:00:00-03:00').getTime())
    api.act(() => listeners.get('pageshow').forEach((fn) => fn()))
    assert.notEqual(globalThis.__seen.at(-1).name, globalThis.__seen[0].name)
    api.act(() => component.unmount())
    assert.equal(countListeners(), 0)
  } finally {
    mock.timers.reset()
  }
})
