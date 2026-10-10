import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDatabase, rawAll, withoutIndexedDb } from './testSupport.js'
import { readCatalogSnapshotMeta, searchCachedCatalog } from './exerciseCache.js'
import {
  downloadFullCatalog,
  ensureCatalogSnapshot,
  needsDownload,
  needsRevisionCheck,
} from './catalogSnapshot.js'

beforeEach(freshDatabase)

const exercise = (id, name, overrides = {}) => ({
  id,
  providerExerciseId: `ext-${id}`,
  provider: 'evolutus',
  name,
  primaryMuscles: ['peito'],
  secondaryMuscles: [],
  equipment: 'barra',
  category: 'forca',
  level: 'iniciante',
  force: 'push',
  mechanic: 'composto',
  instructions: ['x'],
  images: [],
  thumbnail: null,
  ...overrides,
})

// Fake fetchCatalogSyncPage: um array fixo de exercícios, paginado em lotes de até `limit` na
// mesma ordem (simula o keyset real por id) -- devolve só o que vem DEPOIS de afterId.
function pagedFetch(allExercises, { onCall } = {}) {
  return async ({ afterId, limit }) => {
    onCall?.({ afterId, limit })
    const startIndex = afterId ? allExercises.findIndex((e) => e.id === afterId) + 1 : 0
    return allExercises.slice(startIndex, startIndex + limit)
  }
}

test('needsRevisionCheck/needsDownload (puras): primeira sincronização baixa direto, sem checar revisão', () => {
  assert.equal(needsRevisionCheck(undefined, { now: 1000 }), false)
  assert.equal(needsDownload(undefined, { revisionChecked: false, now: 1000 }), true)
})

test('needsRevisionCheck/needsDownload: dentro da janela de 24h, sem force, não precisa checar nem baixar', () => {
  const meta = { complete: true, revision: 'r1', lastCheckedAt: 1000 }
  assert.equal(needsRevisionCheck(meta, { force: false, now: 1000 + 60_000 }), false)
  assert.equal(needsDownload(meta, { revisionChecked: false, now: 1000 + 60_000 }), false)
})

test('needsDownload: revisão indisponível (RPC ainda não existe) força o download depois da janela', () => {
  const meta = { complete: true, revision: 'r1', lastCheckedAt: 0 }
  assert.equal(needsDownload(meta, { revision: null, revisionChecked: true, now: 999999 }), true)
})

test('needsDownload: revisão igual não baixa; revisão diferente baixa', () => {
  const meta = { complete: true, revision: 'r1', lastCheckedAt: 0 }
  assert.equal(needsDownload(meta, { revision: 'r1', revisionChecked: true, now: 999999 }), false)
  assert.equal(needsDownload(meta, { revision: 'r2', revisionChecked: true, now: 999999 }), true)
})

test('downloadFullCatalog pagina por keyset (afterId = último id da página anterior) até uma página curta', async () => {
  const all = Array.from({ length: 120 }, (_, i) => exercise(`c${String(i).padStart(3, '0')}`, `Ex ${i}`))
  const calls = []
  const result = await downloadFullCatalog({ deps: { fetchCatalogSyncPage: pagedFetch(all, { onCall: (c) => calls.push(c) }) } })
  assert.equal(result.length, 120)
  assert.deepEqual(calls.map((c) => c.afterId), [null, 'c049', 'c099'])
  assert.ok(calls.every((c) => c.limit === 50))
})

test('ensureCatalogSnapshot: primeira sincronização grava snapshot completo (sem checar revisão -- nada pra comparar ainda)', async () => {
  const all = [exercise('c1', 'Supino'), exercise('c2', 'Agachamento')]
  const result = await ensureCatalogSnapshot({ deps: { fetchCatalogSyncPage: pagedFetch(all) } })
  assert.equal(result.status, 'synced')
  assert.equal(result.total, 2)
  const meta = await readCatalogSnapshotMeta()
  assert.equal(meta.complete, true)
  assert.equal(meta.totalActive, 2)
  assert.equal((await rawAll('exerciseCatalog')).length, 2)
})

test('ensureCatalogSnapshot: dentro da janela de 24h não chama rede nenhuma, só atualiza lastCheckedAt', async () => {
  const all = [exercise('c1', 'Supino')]
  const t0 = 1_700_000_000_000
  await ensureCatalogSnapshot({ deps: { fetchCatalogSyncPage: pagedFetch(all), now: () => t0 } })

  let revisionCalls = 0
  let pageCalls = 0
  const result = await ensureCatalogSnapshot({
    deps: {
      now: () => t0 + 60 * 60 * 1000, // 1h depois: dentro da janela de 24h
      fetchCatalogRevision: async () => {
        revisionCalls += 1
        return { revision: 'rev-x', totalActive: 1 }
      },
      fetchCatalogSyncPage: pagedFetch(all, { onCall: () => (pageCalls += 1) }),
    },
  })
  assert.equal(result.status, 'skipped')
  assert.equal(revisionCalls, 0, 'nenhuma chamada de revisão dentro da janela')
  assert.equal(pageCalls, 0, 'nenhuma chamada de página dentro da janela')
  const meta = await readCatalogSnapshotMeta()
  assert.equal(meta.lastCheckedAt, t0 + 60 * 60 * 1000)
})

test('ensureCatalogSnapshot: fora da janela, revisão igual não refaz o download', async () => {
  const all = [exercise('c1', 'Supino')]
  const t0 = 1_700_000_000_000
  // sync #1 (primeira vez): não checa revisão, baixa direto -- revisão fica desconhecida (null).
  await ensureCatalogSnapshot({ deps: { fetchCatalogSyncPage: pagedFetch(all), now: () => t0 } })
  // sync #2 (force): agora existe snapshot completo, então a revisão é checada de verdade; 'rev-1'
  // é diferente de null, baixa de novo e PASSA a guardar 'rev-1' como revisão conhecida.
  await ensureCatalogSnapshot({
    force: true,
    deps: {
      now: () => t0 + 1000,
      fetchCatalogRevision: async () => ({ revision: 'rev-1', totalActive: 1 }),
      fetchCatalogSyncPage: pagedFetch(all),
    },
  })

  let pageCalls = 0
  const result = await ensureCatalogSnapshot({
    deps: {
      now: () => t0 + 25 * 60 * 60 * 1000, // > 24h desde o sync #1
      fetchCatalogRevision: async () => ({ revision: 'rev-1', totalActive: 1 }), // mesma revisão do sync #2
      fetchCatalogSyncPage: pagedFetch(all, { onCall: () => (pageCalls += 1) }),
    },
  })
  assert.equal(result.status, 'skipped')
  assert.equal(pageCalls, 0, 'revisão igual -- não baixa de novo')
})

test('ensureCatalogSnapshot: fora da janela, sem suporte à RPC de revisão, baixa de novo (política amortizada)', async () => {
  const all = [exercise('c1', 'Supino')]
  const t0 = 1_700_000_000_000
  await ensureCatalogSnapshot({
    deps: { fetchCatalogSyncPage: pagedFetch(all), now: () => t0, fetchCatalogRevision: async () => ({ revision: 'rev-1', totalActive: 1 }) },
  })

  const result = await ensureCatalogSnapshot({
    deps: {
      now: () => t0 + 25 * 60 * 60 * 1000,
      fetchCatalogRevision: async () => {
        throw Object.assign(new Error('function does not exist'), { code: '42883' })
      },
      fetchCatalogSyncPage: pagedFetch(all),
    },
  })
  assert.equal(result.status, 'synced')
  const meta = await readCatalogSnapshotMeta()
  assert.equal(meta.revision, null)
})

test('ensureCatalogSnapshot: interrupção no meio da sincronização preserva o snapshot anterior intacto', async () => {
  const all = [exercise('c1', 'Supino'), exercise('c2', 'Agachamento')]
  await ensureCatalogSnapshot({ deps: { fetchCatalogSyncPage: pagedFetch(all) } })
  const metaBefore = await readCatalogSnapshotMeta()

  const result = await ensureCatalogSnapshot({
    force: true,
    deps: {
      fetchCatalogRevision: async () => ({ revision: 'rev-2', totalActive: 3 }),
      fetchCatalogSyncPage: async () => {
        throw new Error('rede caiu no meio da varredura')
      },
    },
  })
  assert.equal(result.status, 'error')
  const metaAfter = await readCatalogSnapshotMeta()
  assert.equal(metaAfter.complete, true)
  assert.equal(metaAfter.revision, metaBefore.revision, 'revisão do snapshot anterior não é sobrescrita em falha')
  assert.equal((await rawAll('exerciseCatalog')).length, 2, 'dados antigos preservados, nada apagado')
})

test('ensureCatalogSnapshot: migration da RPC de keyset ainda não aplicada (42883) na PRIMEIRA sincronização -- nunca marca complete=true sobre um catálogo incompleto', async () => {
  const result = await ensureCatalogSnapshot({
    deps: {
      fetchCatalogSyncPage: async () => {
        throw Object.assign(new Error('function list_exercise_catalog_for_sync does not exist'), {
          code: '42883',
        })
      },
    },
  })
  assert.equal(result.status, 'error')
  const meta = await readCatalogSnapshotMeta()
  // touchCatalogSnapshotCheckedAt grava um placeholder (pra UI saber quando foi a última tentativa),
  // mas a invariante real é esta: NUNCA complete=true sobre um catálogo que não foi baixado de verdade.
  assert.notEqual(meta?.complete, true, 'sem migration, o catálogo incompleto nunca é marcado como completo')
  assert.equal(await searchCachedCatalog({ q: 'qualquer coisa' }), undefined, 'busca offline continua honesta: cache ausente, não "zero resultado"')
})

test('ensureCatalogSnapshot: dedup na mesma aba -- duas chamadas concorrentes resultam em UM download real', async () => {
  const all = [exercise('c1', 'Supino')]
  let scansStarted = 0
  const deps = {
    fetchCatalogSyncPage: pagedFetch(all, {
      onCall: ({ afterId }) => {
        if (afterId === null) scansStarted += 1
      },
    }),
  }
  const [a, b] = await Promise.all([ensureCatalogSnapshot({ deps }), ensureCatalogSnapshot({ deps })])
  assert.equal(scansStarted, 1, 'só uma varredura completa foi iniciada')
  assert.equal(a.status, 'synced')
  assert.deepEqual(a, b, 'a segunda chamada reaproveita o resultado da primeira')
})

test('ensureCatalogSnapshot: lock indisponível (outra aba já sincronizando) não baixa nada e não corrompe o cache', async () => {
  const all = [exercise('c1', 'Supino')]
  let pageCalls = 0
  const result = await ensureCatalogSnapshot({
    deps: {
      withSyncLock: async () => ({ acquired: false }),
      fetchCatalogSyncPage: pagedFetch(all, { onCall: () => (pageCalls += 1) }),
    },
  })
  assert.equal(result.status, 'locked')
  assert.equal(pageCalls, 0, 'o trabalho de download nunca roda sem o lock')
  assert.equal(await readCatalogSnapshotMeta(), undefined)
})

test('ensureCatalogSnapshot: offline não tenta nada', async () => {
  let pageCalls = 0
  const result = await ensureCatalogSnapshot({
    deps: { isOnline: () => false, fetchCatalogSyncPage: () => (pageCalls += 1) },
  })
  assert.equal(result.status, 'offline')
  assert.equal(pageCalls, 0)
})

test('ensureCatalogSnapshot: IndexedDB indisponível degrada para "unavailable" sem lançar', async () => {
  const restore = withoutIndexedDb()
  try {
    const all = [exercise('c1', 'Supino')]
    const result = await ensureCatalogSnapshot({ deps: { fetchCatalogSyncPage: pagedFetch(all) } })
    assert.equal(result.status, 'unavailable')
  } finally {
    restore()
  }
})
