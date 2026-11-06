import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let api
const queries = []
let profiles = {}

// supabase/config.js instancia um client real; aqui o supabase é um fake que só entende
// from('public_profiles').select().in(...) e grava cada consulta. Ele NÃO tem channel(): se o hook voltasse a
// abrir um canal Realtime por autor, o teste quebraria.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-avatars-'))
  const outfile = join(directory, 'avatars.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { useCommunityAuthorAvatars, uniqueCommunityAuthorIds, resetAuthorAvatarCache, setCommunityAuthorAvatar } from './useCommunityAuthorAvatars.js'
        import { clearPageCache } from '../utils/pageCache'
        export { uniqueCommunityAuthorIds, resetAuthorAvatarCache, clearPageCache }
        export const updateAvatar = (...args) => act(() => setCommunityAuthorAvatar(...args))
        globalThis.IS_REACT_ACT_ENVIRONMENT = false
        export function mount(props) {
          const box = { current: null }
          function Probe(p) { box.current = useCommunityAuthorAvatars(p.enabled, p.statuses); return null }
          let renderer
          act(() => { renderer = TestRenderer.create(createElement(Probe, props)) })
          return { get avatars() { return box.current }, update: (next) => act(() => renderer.update(createElement(Probe, next))), unmount: () => act(() => renderer.unmount()) }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    plugins: [
      {
        name: 'supabase-config-stub',
        setup(context) {
          context.onResolve({ filter: /\/supabase\/config$/ }, () => ({
            path: 'config',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^config$/, namespace: 'stub' }, () => ({
            contents: `
              export const supabase = { from: (table) => ({ select: () => ({ in: (col, ids) => {
                globalThis.__queries.push({ table, ids })
                const data = ids.filter((id) => id in globalThis.__profiles).map((id) => ({ user_id: id, avatar_path: globalThis.__profiles[id] }))
                return Promise.resolve({ data, error: null })
              } }) }) }
            `,
          }))
        },
      },
    ],
  })
  globalThis.__queries = queries
  api = require(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  queries.length = 0
  profiles = {}
  globalThis.__profiles = profiles
  api.resetAuthorAvatarCache()
})
const tick = (ms = 90) => new Promise((resolve) => setTimeout(resolve, ms))
const authors = (...ids) => ids.map((authorId) => ({ authorId }))

test('uniqueCommunityAuthorIds agrupa e ordena autores sem duplicar', () => {
  const result = api.uniqueCommunityAuthorIds(
    [{ authorId: 'bia' }, { authorId: 'ana' }, { authorId: 'ana' }],
    [{ authorId: 'caio' }, { authorId: null }]
  )
  assert.deepEqual(result, ['ana', 'bia', 'caio'])
})

test('12 autores = 1 consulta em lote (não 12) e nenhum canal Realtime', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `a${i}`)
  ids.forEach((id, i) => (profiles[id] = i % 2 ? `p/${id}` : null))
  const view = api.mount({ enabled: true, statuses: authors(...ids) })
  await tick()
  assert.equal(queries.length, 1)
  assert.equal(queries[0].ids.length, 12)
  assert.equal(view.avatars.a1, 'p/a1')
  assert.equal(view.avatars.a0, null)
  view.unmount()
})

test('nova página só consulta os autores novos; quem já se conhece (inclusive sem foto) não é relido', async () => {
  profiles.a1 = 'p/a1'
  profiles.a3 = 'p/a3'
  const view = api.mount({ enabled: true, statuses: authors('a1', 'a2') })
  await tick()
  view.update({ enabled: true, statuses: authors('a1', 'a2', 'a3') })
  await tick()
  assert.equal(queries.length, 2)
  assert.deepEqual(queries[1].ids, ['a3'])
  view.update({ enabled: true, statuses: authors('a1', 'a2', 'a3') })
  await tick()
  assert.equal(queries.length, 2)
  assert.equal(view.avatars.a3, 'p/a3')
  view.unmount()
})

test('a cache vale para a sessão: outra montagem com os mesmos autores não consulta', async () => {
  profiles.a1 = 'p/a1'
  const first = api.mount({ enabled: true, statuses: authors('a1') })
  await tick()
  first.unmount()
  const second = api.mount({ enabled: true, statuses: authors('a1') })
  await tick()
  assert.equal(queries.length, 1)
  assert.equal(second.avatars.a1, 'p/a1', 'já disponível na primeira renderização')
  second.unmount()
})

test('avatar confirmado atualiza autores montados sem nova consulta', async () => {
  profiles.a1 = 'old.webp'
  const view = api.mount({ enabled: true, statuses: authors('a1') })
  await tick()
  api.updateAvatar('a1', 'new.webp')
  assert.equal(view.avatars.a1, 'new.webp')
  assert.equal(queries.length, 1)
  view.unmount()
})

test('mais de 40 autores viram lotes de até 40', async () => {
  const ids = Array.from({ length: 95 }, (_, i) => `a${String(i).padStart(3, '0')}`)
  const view = api.mount({ enabled: true, statuses: authors(...ids) })
  await tick()
  assert.deepEqual(
    queries.map((q) => q.ids.length),
    [40, 40, 15]
  )
  view.unmount()
})

test('desligado não consulta', async () => {
  const view = api.mount({ enabled: false, statuses: authors('a1') })
  await tick()
  assert.equal(queries.length, 0)
  assert.deepEqual(view.avatars, {})
  view.unmount()
})

test('autores que chegam em momentos diferentes (feed, treinos, destaques) viram UMA consulta', async () => {
  const view = api.mount({ enabled: true, statuses: authors('a1', 'a2') })
  await new Promise((resolve) => setTimeout(resolve, 10))
  view.update({ enabled: true, statuses: authors('a1', 'a2', 'a3') })
  await new Promise((resolve) => setTimeout(resolve, 10))
  view.update({ enabled: true, statuses: authors('a1', 'a2', 'a3', 'a4') })
  await tick()
  assert.equal(queries.length, 1)
  assert.deepEqual([...queries[0].ids].sort(), ['a1', 'a2', 'a3', 'a4'])
  view.unmount()
})

test('trocar de conta/encerrar a sessão (clearPageCache) esquece os avatares em memória', async () => {
  profiles.a1 = 'p/a1'
  const first = api.mount({ enabled: true, statuses: authors('a1') })
  await tick()
  first.unmount()
  assert.equal(queries.length, 1)
  api.clearPageCache() // o que o AuthContext faz ao mudar a identidade da sessão
  const second = api.mount({ enabled: true, statuses: authors('a1') })
  assert.deepEqual(second.avatars, {}, 'nada da sessão anterior na primeira renderização')
  await tick()
  assert.equal(queries.length, 2, 'foi buscado de novo para a nova sessão')
  second.unmount()
})
