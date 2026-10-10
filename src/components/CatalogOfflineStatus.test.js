import { after, afterEach, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

const require = createRequire(import.meta.url)
let directory
let api

// A RPC real (fetchCatalogSyncPage/fetchCatalogRevision, dentro de catalogSnapshot.js -> import
// dinâmico de exerciseCatalogService.js) é trocada por um stub -- o que este teste cobre é a UI
// (estados/textos/botões), não a sincronização em si (já testada a fundo em catalogSnapshot.test.js).
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'catalog-offline-status-'))
  const outfile = join(directory, 'component.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { CatalogOfflineStatus } from './CatalogOfflineStatus.jsx'
        import { cacheCatalogEntries, replaceCatalogSnapshot } from '../services/offline/exerciseCache.js'
        import { closeDatabase } from '../services/offline/database.js'

        export const mount = (props) => {
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({
            matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let component
          act(() => {
            component = TestRenderer.create(createElement(ThemeProvider, null,
              createElement(BaseStyles, null, createElement(CatalogOfflineStatus, props))))
          })
          return component
        }
        export { act, cacheCatalogEntries, replaceCatalogSnapshot, closeDatabase }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    bundle: true,
    write: true,
    outfile,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'error',
    plugins: [
      {
        name: 'catalog-service-stub',
        setup(ctx) {
          ctx.onResolve({ filter: /exerciseCatalogService\.js$/ }, () => ({
            path: 'catalog-service-stub',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^catalog-service-stub$/, namespace: 'stub' }, () => ({
            contents: `
              export function fetchCatalogSyncPage(args) {
                globalThis.__syncPageCalls.push(args)
                return globalThis.__syncPageImpl(args)
              }
              export function fetchCatalogRevision() {
                return globalThis.__revisionImpl()
              }
            `,
          }))
        },
      },
    ],
  })
  api = require(outfile)
})

after(async () => {
  await api.closeDatabase()
  if (directory) await rm(directory, { recursive: true, force: true })
})

function textContent(instance) {
  return instance.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}
const pageText = (component) => textContent(component.root)
const buttonWithText = (component, pattern) =>
  component.root.findAll(
    (node) => typeof node.props.onClick === 'function' && pattern.test(textContent(node))
  )[0]

const START = 'https://proj.supabase.co/storage/v1/object/public/exercise-visuals/c1/v1/start.webp'
const END = 'https://proj.supabase.co/storage/v1/object/public/exercise-visuals/c1/v1/end.webp'
// NUNCA envolver esta espera em act() assíncrono: react-test-renderer's act(async fn) com um
// setTimeout real nunca libera o processo (handle fica pendurado) -- mesmo padrão de
// useHomeDashboard.test.js (settle puro, fora do act).
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(async () => {
  await api.closeDatabase()
  globalThis.indexedDB = new IDBFactory()
  globalThis.__syncPageCalls = []
  globalThis.__syncPageImpl = async () => []
  globalThis.__revisionImpl = async () => ({ revision: 'rev-1', total_active: 0 })
  delete globalThis.caches
  delete globalThis.fetch
})
afterEach(() => {
  delete globalThis.__syncPageCalls
  delete globalThis.__syncPageImpl
  delete globalThis.__revisionImpl
})

test('sem snapshot: "Não preparado", botão "Preparar para uso offline", 0 de 0 imagens', async () => {
  const component = api.mount({ personalExercises: [] })
  await settle()
  const text = pageText(component)
  assert.match(text, /Não preparado/)
  assert.match(text, /0 de 0 arquivos disponíveis/)
  assert.ok(buttonWithText(component, /Preparar para uso offline/))
  assert.ok(!buttonWithText(component, /^Atualizar$/))
})

test('com snapshot completo: "Disponível offline" com a contagem, botão vira "Atualizar"', async () => {
  await api.replaceCatalogSnapshot(
    [{ id: 'c1', name: 'Supino', images: [], thumbnail: null }],
    { revision: 'rev-1' }
  )
  const component = api.mount({ personalExercises: [] })
  await settle()
  const text = pageText(component)
  assert.match(text, /Disponível offline/)
  assert.match(text, /1 exercícios/)
  assert.ok(buttonWithText(component, /^Atualizar$/))
  assert.ok(!buttonWithText(component, /Preparar para uso offline/))
})

test('clicar em "Preparar para uso offline" sincroniza e passa a mostrar "Disponível offline"', async () => {
  globalThis.__syncPageImpl = async ({ afterId }) =>
    afterId ? [] : [
      {
        id: 'c1', provider_exercise_id: 'Bench', provider: 'evolutus_dataset', name: 'Supino',
        primary_muscle: 'peito', muscles: ['peito'], instructions: ['x'],
        source_media_refs: {}, published_media_refs: { images: [] },
      },
    ]
  const component = api.mount({ personalExercises: [] })
  await settle()
  assert.match(pageText(component), /Não preparado/)

  api.act(() => {
    buttonWithText(component, /Preparar para uso offline/).props.onClick()
  })
  await settle(40)
  const text = pageText(component)
  assert.match(text, /Disponível offline/)
  assert.match(text, /1 exercícios/)
})

test('imagens da rotina: resolve pelo catálogo já cacheado e "Preparar imagens" baixa e confirma via Cache Storage', async () => {
  await api.cacheCatalogEntries([
    { id: 'c1', provider: 'evolutus', providerExerciseId: 'ext-1', name: 'Supino', images: [START, END], thumbnail: null },
  ])
  const store = new Map()
  globalThis.caches = {
    open: async () => ({
      match: async (url) => store.get(String(url)),
      put: async (url, response) => void store.set(String(url), response),
    }),
  }
  globalThis.fetch = async (url) => {
    store.set(String(url), new Response('bytes'))
    return new Response('bytes', { status: 200 })
  }

  const component = api.mount({ personalExercises: [{ provider: 'evolutus', providerExerciseId: 'ext-1' }] })
  await settle()
  assert.match(pageText(component), /0 de 2 arquivos disponíveis/)

  api.act(() => {
    buttonWithText(component, /Preparar imagens/).props.onClick()
  })
  await settle(40)
  assert.match(pageText(component), /2 de 2 arquivos disponíveis/)
})
