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

// getExerciseDetail (serviço) é trocado por um stub controlável -- a lógica de cache/snapshot já
// é testada a fundo em services/offline/exerciseCache.test.js. O que este teste cobre é só a
// derivação de fromCache/isPartialCache do HOOK, que depende do IndexedDB real (fake-indexeddb)
// pra decidir se o snapshot está completo -- por isso ainda abre/fecha o banco local de verdade.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'catalog-detail-hook-'))
  const outfile = join(directory, 'hook.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { useExerciseCatalogDetail } from './useExerciseCatalogDetail.js'
        import { markLocalFallback } from '../services/offline/localFallback.js'
        import { replaceCatalogSnapshot } from '../services/offline/exerciseCache.js'
        import { closeDatabase } from '../services/offline/database.js'

        let latest = null
        function Probe(props) { latest = useExerciseCatalogDetail(props.target, { enabled: props.enabled }); return null }
        export const detail = () => latest
        export const mount = (target, enabled = true) => {
          let tree
          act(() => { tree = TestRenderer.create(createElement(Probe, { target, enabled })) })
          return {
            update: (nextTarget, nextEnabled = true) => act(() => tree.update(createElement(Probe, { target: nextTarget, enabled: nextEnabled }))),
            unmount: () => act(() => tree.unmount()),
          }
        }
        export { markLocalFallback, replaceCatalogSnapshot, closeDatabase }
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
              export function getExerciseDetail(args) {
                globalThis.__detailCalls.push(args)
                return globalThis.__detailImpl(args)
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

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(async () => {
  await api.closeDatabase()
  globalThis.indexedDB = new IDBFactory()
  globalThis.__detailCalls = []
  globalThis.__detailImpl = async () => ({ id: 'c1', name: 'Supino', images: [] })
})
afterEach(() => {
  delete globalThis.__detailCalls
  delete globalThis.__detailImpl
})

test('online: detalhe não é marcado como cache', async () => {
  const view = api.mount({ catalogId: 'c1' })
  await settle()
  const state = api.detail()
  assert.equal(state.fromCache, false)
  assert.equal(state.isPartialCache, false)
  assert.equal(state.data.name, 'Supino')
  view.unmount()
})

test('offline com snapshot COMPLETO: fromCache=true e isPartialCache=false', async () => {
  await api.replaceCatalogSnapshot([{ id: 'c1', name: 'Supino', images: [] }], { revision: 'rev-1' })
  globalThis.__detailImpl = async () => api.markLocalFallback({ id: 'c1', name: 'Supino', images: [] })
  const view = api.mount({ catalogId: 'c1' })
  await settle()
  const state = api.detail()
  assert.equal(state.fromCache, true)
  assert.equal(state.isPartialCache, false)
  view.unmount()
})

test('offline SEM snapshot completo (cache oportunístico só): fromCache=true e isPartialCache=true', async () => {
  // Nenhum replaceCatalogSnapshot aqui -- nunca houve sincronização completa neste aparelho.
  globalThis.__detailImpl = async () => api.markLocalFallback({ id: 'c1', name: 'Supino', images: [] })
  const view = api.mount({ catalogId: 'c1' })
  await settle()
  const state = api.detail()
  assert.equal(state.fromCache, true)
  assert.equal(state.isPartialCache, true)
  view.unmount()
})

test('exercício removido do catálogo (null do servidor): nunca lança, unavailable=true e não é cache', async () => {
  globalThis.__detailImpl = async () => null
  const view = api.mount({ catalogId: 'ghost' })
  await settle()
  const state = api.detail()
  assert.equal(state.unavailable, true)
  assert.equal(state.fromCache, false)
  view.unmount()
})
