import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Mesmo padrão de cashPurchaseService.test.js: bundleia promotionsService.js de
// verdade com esbuild, substituindo firebase/firestore, firebase/functions e
// firebase/config por fixtures em memória -- exercita o service real (forma exata de
// cada consulta, dados enviados a cada callable) sem precisar de um app Firebase nem
// do emulador.
async function service({ configDoc = null, docsByCollection = {}, callableResults = {} } = {}) {
  const { outputFiles } = await build({
    entryPoints: ['src/services/promotionsService.js'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'firebase-fixture',
        setup(pluginBuild) {
          pluginBuild.onResolve(
            { filter: /firebase\/firestore|firebase\/functions|firebase\/config$/ },
            (args) => ({ path: args.path, namespace: 'fixture' })
          )
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
            if (path.endsWith('config')) {
              return { contents: 'export const db = {}\nexport const functions = {}' }
            }
            if (path.endsWith('functions')) {
              return {
                contents: `
                  const RESULTS = ${JSON.stringify(callableResults)}
                  export const httpsCallable = (app, name) => async (args) => {
                    globalThis.__callableCalls = globalThis.__callableCalls || []
                    globalThis.__callableCalls.push({ name, args })
                    return { data: RESULTS[name] ?? null }
                  }
                `,
              }
            }
            // firebase/firestore: só o suficiente pra exercitar as consultas reais
            // deste service (where/orderBy/limit contra um array em memória por
            // coleção), sem simular o motor de consultas inteiro. Timestamp.now()
            // devolve um número puro -- só o SHAPE da comparação importa aqui, a
            // semântica real de Timestamp já é coberta pelos testes de Rules/Functions.
            return {
              contents: `
                const CONFIG = ${JSON.stringify(configDoc)}
                const DOCS = ${JSON.stringify(docsByCollection)}
                export const Timestamp = { now: () => 1000 }
                export const doc = (...args) => args
                export const getDoc = async (ref) => {
                  const exists = ref[1] === 'economyConfig/current' && CONFIG != null
                  return { exists: () => exists, data: () => CONFIG }
                }
                export const collection = (_db, name) => ({ name })
                export const where = (field, op, value) => ({ type: 'where', field, op, value })
                export const orderBy = (field, dir) => ({ type: 'orderBy', field, dir })
                export const limit = (n) => ({ type: 'limit', n })
                export const query = (base, ...clauses) => ({ name: base.name, clauses })
                export const getDocs = async (q) => {
                  globalThis.__queries = globalThis.__queries || []
                  globalThis.__queries.push({ collection: q.name, clauses: q.clauses })
                  let items = (DOCS[q.name] || []).slice()
                  for (const clause of q.clauses) {
                    if (clause.type !== 'where') continue
                    items = items.filter((item) => {
                      const value = item[clause.field]
                      if (clause.op === '==') return value === clause.value
                      if (clause.op === '>') return value > clause.value
                      return true
                    })
                  }
                  const orderClause = q.clauses.find((c) => c.type === 'orderBy')
                  if (orderClause) {
                    items.sort((a, b) =>
                      orderClause.dir === 'desc'
                        ? b[orderClause.field] - a[orderClause.field]
                        : a[orderClause.field] - b[orderClause.field]
                    )
                  }
                  const limitClause = q.clauses.find((c) => c.type === 'limit')
                  if (limitClause) items = items.slice(0, limitClause.n)
                  return { docs: items.map((item) => ({ id: item.id, data: () => item })) }
                }
              `,
            }
          })
        },
      },
    ],
  })
  globalThis.__callableCalls = []
  globalThis.__queries = []
  const api = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  )
  return {
    api,
    callableCalls: (name) => globalThis.__callableCalls.filter((call) => call.name === name),
    queries: (collectionName) => globalThis.__queries.filter((q) => q.collection === collectionName),
  }
}

const PACKAGES_CONFIG = {
  version: 3,
  promotionPackages: {
    post_boost_3d: { targetType: 'post', cashAmount: 25, durationDays: 3, label: 'Destaque 3 dias', active: true },
    post_boost_7d: { targetType: 'post', cashAmount: 50, durationDays: 7, label: 'Destaque 7 dias', active: true },
    community_boost_7d: {
      targetType: 'community',
      cashAmount: 100,
      durationDays: 7,
      label: 'Comunidade em destaque 7 dias',
      active: true,
    },
    old_pack: { targetType: 'post', cashAmount: 10, durationDays: 1, label: 'Descontinuado', active: false },
  },
}

test('getPromotionPackages returns only active packages, and filters by targetType when given', async () => {
  const { api } = await service({ configDoc: PACKAGES_CONFIG })
  const all = await api.getPromotionPackages()
  assert.deepEqual(
    all.map((p) => p.packageId).sort(),
    ['community_boost_7d', 'post_boost_3d', 'post_boost_7d']
  )
  const postOnly = await api.getPromotionPackages('post')
  assert.deepEqual(
    postOnly.map((p) => p.packageId).sort(),
    ['post_boost_3d', 'post_boost_7d']
  )
})

test('getPromotionPackages with a missing economyConfig document returns an empty list, never a hardcoded fallback', async () => {
  const { api } = await service({ configDoc: null })
  assert.deepEqual(await api.getPromotionPackages(), [])
})

test('createPromotion forwards targetType/targetId/packageId/requestId untouched to the callable', async () => {
  const { api, callableCalls } = await service({
    callableResults: { createPromotion: { promotionId: 'p1', status: 'active' } },
  })
  const result = await api.createPromotion({
    targetType: 'post',
    targetId: 's1',
    packageId: 'post_boost_3d',
    requestId: 'req-1',
  })
  assert.equal(result.promotionId, 'p1')
  assert.deepEqual(callableCalls('createPromotion')[0].args, {
    targetType: 'post',
    targetId: 's1',
    packageId: 'post_boost_3d',
    requestId: 'req-1',
  })
})

test('cancelPromotion forwards promotionId/reason to the callable', async () => {
  const { api, callableCalls } = await service({
    callableResults: { cancelPromotion: { promotionId: 'p1' } },
  })
  await api.cancelPromotion({ promotionId: 'p1', reason: 'motivo' })
  assert.deepEqual(callableCalls('cancelPromotion')[0].args, { promotionId: 'p1', reason: 'motivo' })
})

test('recordPromotionClick forwards targetType/targetId/promotionId and always sends type:"click"', async () => {
  const { api, callableCalls } = await service({
    callableResults: { recordPromotionEvent: { recorded: true } },
  })
  await api.recordPromotionClick({ targetType: 'post', targetId: 's1', promotionId: 'p1' })
  assert.deepEqual(callableCalls('recordPromotionEvent')[0].args, {
    targetType: 'post',
    targetId: 's1',
    promotionId: 'p1',
    type: 'click',
  })
})

test('listFeaturedStatusesForCommunity filters by communityId+promoted+promotedUntil>now, never limits before that filter', async () => {
  const { api, queries } = await service({
    docsByCollection: {
      statuses: [
        { id: 's1', communityId: 'c1', promoted: true, promotedUntil: 5000 },
        { id: 's2', communityId: 'c1', promoted: true, promotedUntil: 500 }, // expirado
        { id: 's3', communityId: 'c2', promoted: true, promotedUntil: 5000 }, // outra comunidade
        { id: 's4', communityId: 'c1', promoted: false, promotedUntil: 5000 },
      ],
    },
  })
  const result = await api.listFeaturedStatusesForCommunity('c1')
  assert.deepEqual(
    result.map((s) => s.id),
    ['s1']
  )
  const [call] = queries('statuses')
  const clauseTypes = call.clauses.map((c) => `${c.type}:${c.field ?? ''}:${c.op ?? ''}`)
  assert.ok(clauseTypes.includes('where:communityId:=='))
  assert.ok(clauseTypes.includes('where:promoted:=='))
  assert.ok(clauseTypes.includes('where:promotedUntil:>'), 'filtro de expiração precisa estar na consulta, não só no client')
})

test('listFeaturedCommunities filters by promoted+promotedUntil>now', async () => {
  const { api } = await service({
    docsByCollection: {
      communities: [
        { id: 'c1', promoted: true, promotedUntil: 5000 },
        { id: 'c2', promoted: true, promotedUntil: 100 },
        { id: 'c3', promoted: false, promotedUntil: 5000 },
      ],
    },
  })
  const result = await api.listFeaturedCommunities()
  assert.deepEqual(
    result.map((c) => c.id),
    ['c1']
  )
})

test('listMyPromotions filters by ownerId, ordered by createdAt desc', async () => {
  const { api } = await service({
    docsByCollection: {
      promotions: [
        { id: 'p1', ownerId: 'alice', createdAt: 100 },
        { id: 'p2', ownerId: 'bob', createdAt: 300 },
        { id: 'p3', ownerId: 'alice', createdAt: 200 },
      ],
    },
  })
  const result = await api.listMyPromotions('alice')
  assert.deepEqual(
    result.map((p) => p.id),
    ['p3', 'p1']
  )
})

test('listAllPromotionsForAdmin returns everyone, ordered by createdAt desc (no ownerId filter)', async () => {
  const { api } = await service({
    docsByCollection: {
      promotions: [
        { id: 'p1', ownerId: 'alice', createdAt: 100 },
        { id: 'p2', ownerId: 'bob', createdAt: 300 },
      ],
    },
  })
  const result = await api.listAllPromotionsForAdmin()
  assert.deepEqual(
    result.map((p) => p.id),
    ['p2', 'p1']
  )
})
