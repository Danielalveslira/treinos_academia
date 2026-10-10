import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Cabeçalho + hook, renderizados de verdade (react-test-renderer), com o serviço de RPC trocado por um dublê
// e `window`/`document` mínimos que contam listeners -- assim também se prova que nada fica ativo ao desmontar.
let directory
let api
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'greeting-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement, useState } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { DashboardGreeting } from './DashboardGreeting.jsx'
        import { useDashboardGreeting } from './useDashboardGreeting.js'

        export { act }

        // Imita o AuthProvider: perfil em estado + patchProfile protegido por identidade.
        function Harness({ initialProfile, user, mountHeader = true, enabled = true, dynamic = true, ...input }) {
          const [profile, setProfile] = useState(initialProfile)
          const { greeting, onShown } = useDashboardGreeting({
            profile,
            user,
            enabled,
            ...input,
            onWelcomeAcknowledged: (userId, seenAt) => {
              globalThis.__patches.push([userId, seenAt])
              if (userId === user?.uid) setProfile((previous) => ({ ...previous, greetingWelcomeSeenAt: seenAt }))
            },
          })
          globalThis.__last = greeting
          globalThis.__profile = profile
          return mountHeader
            ? createElement(DashboardGreeting, { greeting, onShown, dynamic })
            : createElement('div', null, greeting.heading)
        }

        export function element(base, override) {
          return createElement(ThemeProvider, null, createElement(BaseStyles, null, createElement(Harness, { ...base, ...override })))
        }

        export function render(props) {
          let component
          act(() => {
            component = TestRenderer.create(
              createElement(ThemeProvider, null, createElement(BaseStyles, null, createElement(Harness, props)))
            )
          })
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
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'stub-greeting-rpc',
        setup(builder) {
          builder.onResolve({ filter: /greetingPreferencesService/ }, () => ({
            path: 'rpc-stub',
            namespace: 'stub',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export const acknowledgeGreetingWelcome = (...a) => globalThis.__ack(...a)',
            loader: 'js',
          }))
        },
      },
    ],
  })
  api = createRequire(import.meta.url)(outfile)
})
after(() => rm(directory, { recursive: true, force: true }))

let listeners
let acks
beforeEach(() => {
  listeners = { window: new Map(), document: new Map() }
  const target = (name) => ({
    addEventListener: (type, fn) =>
      listeners[name].set(type, [...(listeners[name].get(type) ?? []), fn]),
    removeEventListener: (type, fn) =>
      listeners[name].set(
        type,
        (listeners[name].get(type) ?? []).filter((item) => item !== fn)
      ),
  })
  globalThis.window = {
    ...target('window'),
    matchMedia: () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
  }
  globalThis.document = { ...target('document'), visibilityState: 'visible' }
  globalThis.__patches = []
  acks = { calls: 0, impl: async () => '2026-10-25T12:00:00.000Z' }
  globalThis.__ack = () => {
    acks.calls += 1
    return acks.impl()
  }
})
const activeListeners = () =>
  [...listeners.window.values(), ...listeners.document.values()].reduce(
    (sum, list) => sum + list.length,
    0
  )
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 15))
  api.act(() => {})
}
const textOf = (component) => JSON.stringify(component.toJSON())

const CUTOFF = Date.parse('2026-10-24T00:00:00-03:00')
const newcomer = {
  id: 'u1',
  username: 'ana',
  accountStatus: 'active',
  createdAt: '2026-10-25T10:00:00Z',
  greetingWelcomeSeenAt: null,
  greetingVoice: 'auto',
  sexo: 'feminino',
}
const baseProps = {
  initialProfile: newcomer,
  user: { uid: 'u1' },
  todayState: 'none',
  now: new Date(2026, 9, 26, 9, 0, 0),
  welcomeCutoffMs: CUTOFF,
}
const welcomeProps = { ...baseProps, enabled: true }

test('cabeçalho renderiza eyebrow + h1 como texto, sem aria-live', () => {
  const component = api.render({
    ...welcomeProps,
    initialProfile: { ...newcomer, greetingWelcomeSeenAt: '2026-10-25T09:00:00Z' },
  })
  const json = textOf(component)
  assert.match(json, /SEU RITMO, SUA EVOLUÇÃO/)
  assert.doesNotMatch(json, /aria-live/)
  const h1 = component.root.findAll((node) => node.type === 'h1')
  assert.equal(h1.length, 1)
})

test('flag desligada: saudação anterior e nenhuma RPC', async () => {
  const component = api.render({ ...baseProps, enabled: false })
  await settle()
  assert.match(textOf(component), /Bom dia/)
  assert.equal(acks.calls, 0)
})

test('conta antiga ou sem corte configurado: nunca há ACK', async () => {
  api.render({ ...welcomeProps, welcomeCutoffMs: null })
  api.render({
    ...welcomeProps,
    initialProfile: { ...newcomer, createdAt: '2026-01-01T00:00:00Z' },
  })
  await settle()
  assert.equal(acks.calls, 0)
})

test('primeira Home: mostra boas-vindas, faz UM ACK e a frase NÃO muda quando o servidor confirma', async () => {
  const component = api.render(welcomeProps)
  await settle()
  assert.equal(globalThis.__last.isWelcome, true)
  const before = globalThis.__last.heading
  assert.match(textOf(component), /BOAS-VINDAS AO EVOLUTUS/)
  assert.equal(acks.calls, 1)
  assert.deepEqual(globalThis.__patches, [['u1', '2026-10-25T12:00:00.000Z']])
  // depois do ACK o perfil já tem greetingWelcomeSeenAt, e a frase continua a mesma
  await settle()
  assert.equal(globalThis.__last.heading, before)
  assert.equal(globalThis.__last.isWelcome, true)
  assert.equal(acks.calls, 1, 'nenhum segundo ACK')
})

test('cabeçalho não montado (carregando/erro): nada é exibido, logo nada é confirmado', async () => {
  api.render({ ...welcomeProps, mountHeader: false })
  await settle()
  assert.equal(acks.calls, 0)
  assert.deepEqual(globalThis.__patches, [])
})

test('aba oculta: só confirma quando ficar visível', async () => {
  globalThis.document.visibilityState = 'hidden'
  api.render(welcomeProps)
  await settle()
  assert.equal(acks.calls, 0)
  globalThis.document.visibilityState = 'visible'
  api.act(() => listeners.document.get('visibilitychange').forEach((fn) => fn()))
  await settle()
  assert.equal(acks.calls, 1)
})

test('offline local: mostra a saudação normal e não grava nada', async () => {
  api.render({ ...welcomeProps, offlineLocal: true })
  await settle()
  assert.notEqual(globalThis.__last.isWelcome, true)
  assert.equal(acks.calls, 0)
})

test('já confirmada em outro aparelho: saudação normal e nenhum ACK', async () => {
  api.render({
    ...welcomeProps,
    initialProfile: { ...newcomer, greetingWelcomeSeenAt: '2026-10-25T09:00:00Z' },
  })
  await settle()
  assert.notEqual(globalThis.__last.isWelcome, true)
  assert.equal(acks.calls, 0)
})

test('ACK com falha: a Home segue estável, sem laço de retry; a volta da rede tenta de novo uma vez', async () => {
  acks.impl = async () => {
    throw new Error('network')
  }
  const component = api.render(welcomeProps)
  await settle()
  await settle()
  assert.equal(acks.calls, 1, 'sem retry automático')
  assert.equal(globalThis.__last.isWelcome, true)
  assert.deepEqual(globalThis.__patches, [])
  acks.impl = async () => '2026-10-25T12:30:00.000Z'
  api.act(() => listeners.window.get('online').forEach((fn) => fn()))
  await settle()
  assert.equal(acks.calls, 2)
  assert.deepEqual(globalThis.__patches, [['u1', '2026-10-25T12:30:00.000Z']])
  api.act(() => component.unmount())
  assert.equal(activeListeners(), 0)
})

test('troca de conta durante o voo: o resultado tardio da conta anterior não vai para a nova', async () => {
  const releases = []
  acks.impl = () => new Promise((resolve) => releases.push(resolve))
  const component = api.render(welcomeProps)
  await settle()
  assert.equal(acks.calls, 1)
  // a conta "u2" assume o lugar (o harness só aplica patch à conta atual, como o AuthProvider real)
  api.act(() => {
    component.update(
      api.element(welcomeProps, { user: { uid: 'u2' }, initialProfile: { ...newcomer, id: 'u2' } })
    )
  })
  await settle()
  assert.equal(acks.calls, 2, 'a conta nova confirma as PRÓPRIAS boas-vindas')
  releases[0]('T-conta-anterior')
  await settle()
  assert.equal(
    globalThis.__profile.greetingWelcomeSeenAt,
    null,
    'resultado da conta anterior descartado'
  )
  releases[1]('T-conta-nova')
  await settle()
  assert.equal(globalThis.__profile.greetingWelcomeSeenAt, 'T-conta-nova')
})

test('desmontar remove todos os listeners do hook de saudação', () => {
  const component = api.render({ ...baseProps, enabled: true })
  api.act(() => component.unmount())
  assert.equal(activeListeners(), 0)
})

test('classe --dynamic (CSS novo) só existe com a V2 ligada: o cabeçalho legado não muda de visual', () => {
  const on = api.render({ ...welcomeProps, dynamic: true })
  assert.match(textOf(on), /dashboard-greeting dashboard-greeting--dynamic/)
  const off = api.render({ ...welcomeProps, enabled: false, dynamic: false })
  assert.doesNotMatch(textOf(off), /--dynamic/)
})
