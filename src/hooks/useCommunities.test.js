import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// A listagem "Explorar" recebe o estado de acesso do usuário numa ÚNICA consulta junto com as comunidades
// (nunca uma chamada por cartão), e uma tentativa de entrada recusada por banimento troca o cartão para
// "bloqueado" imediatamente, sem recarregar. Serviços são fakes que contam as chamadas.
let directory
let mount
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'use-communities-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { useCommunities } from './useCommunities.js'

        export const mount = () => {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          const box = { current: null }
          function Probe() {
            box.current = useCommunities()
            return null
          }
          let renderer
          act(() => { renderer = TestRenderer.create(createElement(Probe)) })
          return { box, renderer }
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
    plugins: [
      {
        name: 'fakes',
        setup(pluginBuild) {
          const fake = (filter, contents) => {
            pluginBuild.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'fake' }))
            pluginBuild.onLoad({ filter, namespace: 'fake' }, (args) => ({
              contents: contents(args.path),
              loader: 'js',
            }))
          }
          fake(/\/useAuth(\.js)?$/, () => `export const useAuth = () => ({ user: { uid: 'u1' } })`)
          fake(
            /\/services\/communitiesService(\.js)?$/,
            () =>
              `export const listActiveCommunities = async () => { globalThis.__calls.push('listActiveCommunities'); return globalThis.__communities }`
          )
          fake(
            /\/services\/communityMembersService(\.js)?$/,
            () => `
              export const listMyCommunityAccess = async () => { globalThis.__calls.push('listMyCommunityAccess'); return { ...globalThis.__access } }
              export const joinCommunity = async (id) => { globalThis.__calls.push('joinCommunity:' + id); if (globalThis.__joinError) throw globalThis.__joinError; return globalThis.__joinResult }
              export const leaveCommunity = async (id) => { globalThis.__calls.push('leaveCommunity:' + id) }
              export const getCommunityAccess = async () => { globalThis.__calls.push('getCommunityAccess'); return 'member' }
            `
          )
        },
      },
    ],
  })
  ;({ mount } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(async () => {
  const { clearPageCache } = await import('../utils/pageCache.js')
  clearPageCache()
  globalThis.__calls = []
  globalThis.__communities = Array.from({ length: 40 }, (_, i) => ({
    id: `c${i}`,
    name: `Comunidade ${i}`,
  }))
  globalThis.__access = { c0: 'member', c1: 'banned' }
  globalThis.__joinResult = 'joined'
  globalThis.__joinError = null
})

test('carrega 40 comunidades com UMA consulta de comunidades e UMA de acesso (sem N+1)', async () => {
  const { box, renderer } = mount()
  await wait()
  assert.deepEqual(globalThis.__calls, ['listActiveCommunities', 'listMyCommunityAccess'])
  assert.equal(box.current.myCommunities.length, 1)
  assert.equal(box.current.exploreCommunities.length, 39)
  const banned = box.current.exploreCommunities.find((c) => c.id === 'c1')
  assert.equal(banned.access, 'banned')
  assert.equal(box.current.exploreCommunities.find((c) => c.id === 'c2').access, 'not_member')
  assert.ok(!globalThis.__calls.includes('getCommunityAccess'))
  renderer.unmount()
})

test('tentativa recusada por banimento marca o cartão como banned na hora, sem recarregar a lista', async () => {
  const { box, renderer } = mount()
  await wait()
  globalThis.__calls = []
  globalThis.__joinResult = 'banned'
  const result = await box.current.join('c2')
  await wait()
  assert.equal(result, 'banned')
  assert.equal(box.current.exploreCommunities.find((c) => c.id === 'c2').access, 'banned')
  assert.equal(
    box.current.myCommunities.find((c) => c.id === 'c2'),
    undefined
  )
  assert.deepEqual(globalThis.__calls, ['joinCommunity:c2'])
  renderer.unmount()
})

test('entrada bem-sucedida move a comunidade para "Minhas"', async () => {
  const { box, renderer } = mount()
  await wait()
  globalThis.__joinResult = 'joined'
  await box.current.join('c3')
  await wait()
  assert.ok(box.current.myCommunities.some((c) => c.id === 'c3'))
  assert.ok(!box.current.exploreCommunities.some((c) => c.id === 'c3'))
  renderer.unmount()
})

test('comunidade indisponível vira indisponível no cartão', async () => {
  const { box, renderer } = mount()
  await wait()
  globalThis.__joinResult = 'unavailable'
  await box.current.join('c4')
  await wait()
  assert.equal(box.current.exploreCommunities.find((c) => c.id === 'c4').access, 'unavailable')
  renderer.unmount()
})

test('falha real ao entrar propaga e não altera o estado dos cartões', async () => {
  const { box, renderer } = mount()
  await wait()
  globalThis.__joinError = new TypeError('Failed to fetch')
  await assert.rejects(box.current.join('c5'), TypeError)
  await wait()
  assert.equal(box.current.exploreCommunities.find((c) => c.id === 'c5').access, 'not_member')
  renderer.unmount()
})
