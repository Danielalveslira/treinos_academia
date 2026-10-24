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

// Este hook só decide COMO mostrar o resultado (fromCache/isPartialCache); a lógica de quando um
// resultado é cache parcial vs. snapshot completo já é testada a fundo em
// services/offline/exerciseCache.test.js e exerciseCatalogService.test.js. Por isso o serviço real
// (searchExercises) é trocado por um stub simples e controlável -- não precisa de supabase/IndexedDB
// pra testar só a derivação de estado do hook.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'catalog-search-hook-'))
  const outfile = join(directory, 'hook.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { useExerciseCatalogSearch } from './useExerciseCatalogSearch.js'
        import { markLocalFallback } from '../services/offline/localFallback.js'

        let latest = null
        function Probe(props) { latest = useExerciseCatalogSearch(props); return null }
        export const search = () => latest
        export const mount = (props) => {
          let tree
          act(() => { tree = TestRenderer.create(createElement(Probe, props)) })
          return {
            update: (next) => act(() => tree.update(createElement(Probe, next))),
            unmount: () => act(() => tree.unmount()),
          }
        }
        export { markLocalFallback }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    bundle: true,
    write: true,
    outfile,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'error',
    plugins: [
      {
        name: 'catalog-service-stub',
        setup(ctx) {
          ctx.onResolve({ filter: /\/services\/exerciseCatalogService\.js$/ }, () => ({
            path: 'catalog-service-stub',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^catalog-service-stub$/, namespace: 'stub' }, () => ({
            contents: `
              export function searchExercises(args) {
                globalThis.__searchCalls.push(args)
                return globalThis.__searchImpl(args)
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
  if (directory) await rm(directory, { recursive: true, force: true })
})

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  globalThis.__searchCalls = []
  globalThis.__searchImpl = async () => ({ data: [], total: 0 })
})

test('online: resultado nunca é marcado como cache', async () => {
  globalThis.__searchImpl = async () => ({ data: [{ id: 'c1', name: 'Supino' }], total: 1 })
  const view = api.mount({ enabled: true, q: '', category: 'forca' })
  await settle()
  const state = api.search()
  assert.equal(state.fromCache, false)
  assert.equal(state.isPartialCache, false)
  assert.equal(state.items.length, 1)
  view.unmount()
})

test('abertura sem busca/filtros (noQueryIntent) carrega a primeira página automaticamente -- nunca fica vazia à espera de interação', async () => {
  globalThis.__searchImpl = async (args) => {
    assert.equal(args.offset, 0)
    assert.equal(args.limit, 20)
    return { data: [{ id: 'c1', name: 'Supino' }, { id: 'c2', name: 'Agachamento' }], total: 2 }
  }
  const view = api.mount({ enabled: true, q: '' })
  await settle()
  const state = api.search()
  assert.equal(state.noQueryIntent, true)
  assert.equal(state.items.length, 2)
  assert.equal(state.loading, false)
  assert.equal(globalThis.__searchCalls.length, 1)
  view.unmount()
})

test('voltar ao estado vazio (depois de digitar e limpar) recarrega a vitrine inicial, não trava em branco', async () => {
  let callCount = 0
  globalThis.__searchImpl = async (args) => {
    callCount += 1
    return args.q ? { data: [{ id: 'c1', name: 'Supino' }], total: 1 } : { data: [{ id: 'c2', name: 'Agachamento' }], total: 1 }
  }
  const view = api.mount({ enabled: true, q: 'supino' })
  await settle(500)
  assert.equal(api.search().items[0]?.id, 'c1')

  view.update({ enabled: true, q: '' })
  await settle()
  assert.equal(api.search().noQueryIntent, true)
  assert.equal(api.search().items[0]?.id, 'c2')
  assert.ok(callCount >= 2)
  view.unmount()
})

test('offline com snapshot COMPLETO: fromCache=true e isPartialCache=false (zero resultado é verdadeiro)', async () => {
  globalThis.__searchImpl = async () => api.markLocalFallback({ data: [], total: 0, complete: true })
  const view = api.mount({ enabled: true, q: '', category: 'forca' })
  await settle()
  const state = api.search()
  assert.equal(state.fromCache, true)
  assert.equal(state.isPartialCache, false)
  assert.deepEqual(state.items, [])
  view.unmount()
})

test('offline com cache PARCIAL (snapshot incompleto): fromCache=true e isPartialCache=true', async () => {
  globalThis.__searchImpl = async () =>
    api.markLocalFallback({ data: [{ id: 'c1', name: 'Supino' }], total: 1, complete: false })
  const view = api.mount({ enabled: true, q: '', category: 'forca' })
  await settle()
  const state = api.search()
  assert.equal(state.fromCache, true)
  assert.equal(state.isPartialCache, true)
  view.unmount()
})
