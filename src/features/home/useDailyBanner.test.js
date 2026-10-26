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
        import { getDashboardBannerSequence } from './dashboardBanners.js'
        import { useDailyBanner } from './useDailyBanner.js'
        export { act }
        const PHOTOS = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
        function Probe({sexo,personalized=false}) {
          const photo = useDailyBanner(personalized ? getDashboardBannerSequence(sexo) : PHOTOS)
          globalThis.__seen.push(photo)
          return null
        }
        export const updateProfile = (root,sexo) => act(()=>root.update(createElement(Probe,{sexo,personalized:true})))
        export function render(props = {}) {
          let component
          act(() => { component = TestRenderer.create(createElement(Probe,props)) })
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

test('suspensão prolongada e virada de mês: resume usa o dia atual, sem percorrer dias perdidos', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-12-31T23:50:00-03:00') })
  try {
    const component = api.render()
    const first = globalThis.__seen.at(-1)
    globalThis.document.visibilityState = 'hidden'
    mock.timers.setTime(new Date('2027-01-05T00:05:00-03:00').getTime())
    api.act(() => listeners.get('pageshow').forEach((fn) => fn()))
    assert.deepEqual(globalThis.__seen.at(-1), first)
    globalThis.document.visibilityState = 'visible'
    api.act(() => listeners.get('visibilitychange').forEach((fn) => fn()))
    assert.notEqual(globalThis.__seen.at(-1).name, first.name)
    api.act(() => component.unmount())
  } finally {
    mock.timers.reset()
  }
})

test('perfil atualiza a foto sem recarregar nem reiniciar o relógio do dia', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-26T12:00:00-03:00') })
  try {
    const root = api.render({ sexo: 'masculino', personalized: true })
    assert.equal(globalThis.__seen.at(-1).name, 'capa')
    api.updateProfile(root, 'feminino')
    assert.equal(globalThis.__seen.at(-1).name, 'sexo_mulher')
    api.updateProfile(root, 'nao_informar')
    assert.equal(globalThis.__seen.at(-1).name, 'home-banner-anilhas')
    assert.equal(
      [...listeners.values()].reduce((n, list) => n + list.length, 0),
      2
    )
    api.act(() => root.unmount())
  } finally {
    mock.timers.reset()
  }
})

for (const sexo of ['masculino', 'feminino', 'nao_informar'])
  test(`meia-noite SP aplica sequência de ${sexo}`, () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-26T23:59:00-03:00') })
    try {
      const root = api.render({ sexo, personalized: true })
      assert.equal(
        globalThis.__seen.at(-1).name,
        sexo === 'masculino' ? 'capa' : sexo === 'feminino' ? 'sexo_mulher' : 'home-banner-anilhas'
      )
      api.act(() => mock.timers.tick(120000))
      assert.equal(
        globalThis.__seen.at(-1).name,
        sexo === 'nao_informar' ? 'home-banner-equipe' : 'home-banner-anilhas'
      )
      api.act(() => root.unmount())
    } finally {
      mock.timers.reset()
    }
  })
