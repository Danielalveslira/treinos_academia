import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Mesmo padrão de economyService.test.js: bundleia cashPurchaseService.js de verdade
// com esbuild, substituindo firebase/firestore, firebase/functions e firebase/config
// por fixtures em memória -- exercita o service real (filtro de pacotes ativos,
// paginação por cursor, quais campos chegam em cada callable) sem precisar de um app
// Firebase nem do emulador.
async function service({ configDoc = null, purchaseDocs = [], callableResults = {} } = {}) {
  const { outputFiles } = await build({
    entryPoints: ['src/services/cashPurchaseService.js'],
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
            // firebase/firestore: só o suficiente pra exercitar as duas formas de
            // consulta reais deste service (economyConfig/current via getDoc; cashPurchases
            // via query/where/orderBy/limit/startAfter), sem simular o motor inteiro.
            return {
              contents: `
                const CONFIG = ${JSON.stringify(configDoc)}
                const PURCHASES = ${JSON.stringify(purchaseDocs)}
                export const doc = (...args) => args
                export const getDoc = async (ref) => {
                  const exists = ref[1] === 'economyConfig/current' && CONFIG != null
                  return { exists: () => exists, data: () => CONFIG }
                }
                export const collection = (...args) => args
                export const where = (field, op, value) => ({ type: 'where', field, op, value })
                export const orderBy = (field, dir) => ({ type: 'orderBy', field, dir })
                export const limit = (n) => ({ type: 'limit', n })
                export const startAfter = (cursorDoc) => ({ type: 'startAfter', cursorDoc })
                export const query = (_base, ...clauses) => ({ clauses })
                export const getDocs = async (q) => {
                  globalThis.__getDocsCalls = (globalThis.__getDocsCalls || 0) + 1
                  let items = PURCHASES.slice()
                  for (const clause of q.clauses) {
                    if (clause.type === 'where') items = items.filter((item) => item[clause.field] === clause.value)
                  }
                  const orderClause = q.clauses.find((c) => c.type === 'orderBy')
                  if (orderClause) {
                    items.sort((a, b) =>
                      orderClause.dir === 'desc' ? b[orderClause.field] - a[orderClause.field] : a[orderClause.field] - b[orderClause.field]
                    )
                  }
                  const startAfterClause = q.clauses.find((c) => c.type === 'startAfter')
                  if (startAfterClause) {
                    const index = items.findIndex((item) => item.id === startAfterClause.cursorDoc.id)
                    items = index === -1 ? items : items.slice(index + 1)
                  }
                  const limitClause = q.clauses.find((c) => c.type === 'limit')
                  if (limitClause) items = items.slice(0, limitClause.n)
                  return { size: items.length, docs: items.map((item) => ({ id: item.id, data: () => item })) }
                }
              `,
            }
          })
        },
      },
    ],
  })
  globalThis.__getDocsCalls = 0
  globalThis.__callableCalls = []
  const api = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  )
  return {
    api,
    getDocsCalls: () => globalThis.__getDocsCalls,
    callableCalls: (name) => globalThis.__callableCalls.filter((call) => call.name === name),
  }
}

const PACKAGES_CONFIG = {
  version: 3,
  pixKey: 'chave-pix-teste@evolutus.app',
  cashPackages: {
    pack_100: { cashAmount: 100, amountCentavos: 990, label: '100 EvoCash', active: true },
    pack_550: { cashAmount: 550, amountCentavos: 4990, label: '550 EvoCash', active: true },
    pack_old: { cashAmount: 10, amountCentavos: 100, label: 'Descontinuado', active: false },
  },
}

test('an authenticated user loads only the active packages, never an inactive one', async () => {
  const { api } = await service({ configDoc: PACKAGES_CONFIG })
  const { packages } = await api.getCashPurchaseSettings()
  assert.deepEqual(
    packages.map((pkg) => pkg.packageId).sort(),
    ['pack_100', 'pack_550']
  )
  assert.equal(packages.some((pkg) => pkg.packageId === 'pack_old'), false)
})

test('the PIX key comes from central config, not hardcoded in the service', async () => {
  const { api } = await service({ configDoc: PACKAGES_CONFIG })
  const { pixKey } = await api.getCashPurchaseSettings()
  assert.equal(pixKey, 'chave-pix-teste@evolutus.app')
})

test('missing economyConfig document yields no packages and no PIX key, never a hardcoded fallback', async () => {
  const { api } = await service({ configDoc: null })
  const settings = await api.getCashPurchaseSettings()
  assert.deepEqual(settings.packages, [])
  assert.equal(settings.pixKey, null)
  assert.equal(settings.createCommunityCashCost, null)
})

test('createCommunityCashCost comes from the same economyConfig document (privileges.createCommunity.cashCost)', async () => {
  const { api } = await service({
    configDoc: { ...PACKAGES_CONFIG, privileges: { createCommunity: { cashCost: 50 } } },
  })
  const settings = await api.getCashPurchaseSettings()
  assert.equal(settings.createCommunityCashCost, 50)
})

test('createCommunityCashCost is null when the block is missing or malformed, never an invented default', async () => {
  const missing = await (await service({ configDoc: PACKAGES_CONFIG })).api.getCashPurchaseSettings()
  assert.equal(missing.createCommunityCashCost, null)

  const malformed = await (
    await service({ configDoc: { ...PACKAGES_CONFIG, privileges: { createCommunity: { cashCost: 0 } } } })
  ).api.getCashPurchaseSettings()
  assert.equal(malformed.createCommunityCashCost, null)
})

test('requestCashPurchase forwards packageId and requestId untouched to the callable (retry reuses the same requestId end to end)', async () => {
  const { api, callableCalls } = await service({
    callableResults: { requestCashPurchase: { purchaseId: 'p1', status: 'pending' } },
  })
  await api.requestCashPurchase({ packageId: 'pack_100', requestId: 'same-request-id' })
  await api.requestCashPurchase({ packageId: 'pack_100', requestId: 'same-request-id' })
  const calls = callableCalls('requestCashPurchase')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args, { packageId: 'pack_100', requestId: 'same-request-id' })
  assert.deepEqual(calls[1].args, { packageId: 'pack_100', requestId: 'same-request-id' })
})

test('confirmCashPurchase sends purchaseId and adminNote to the callable', async () => {
  const { api, callableCalls } = await service({
    callableResults: { confirmCashPurchase: { purchaseId: 'p1', cashAmount: 100 } },
  })
  await api.confirmCashPurchase('p1', 'PIX recebido, comprovante #123')
  assert.deepEqual(callableCalls('confirmCashPurchase')[0].args, {
    purchaseId: 'p1',
    adminNote: 'PIX recebido, comprovante #123',
  })
})

test('cancelCashPurchase sends purchaseId and the required reason to the callable', async () => {
  const { api, callableCalls } = await service({
    callableResults: { cancelCashPurchase: { purchaseId: 'p1' } },
  })
  await api.cancelCashPurchase('p1', 'usuário desistiu da compra')
  assert.deepEqual(callableCalls('cancelCashPurchase')[0].args, {
    purchaseId: 'p1',
    reason: 'usuário desistiu da compra',
  })
})

const PURCHASE_DOCS = [
  { id: 'a1', userId: 'alice', status: 'pending', createdAt: 300, packageLabel: '100 EvoCash' },
  { id: 'a2', userId: 'alice', status: 'credited', createdAt: 200, packageLabel: '550 EvoCash' },
  { id: 'a3', userId: 'alice', status: 'cancelled', createdAt: 100, packageLabel: '100 EvoCash' },
  { id: 'b1', userId: 'bob', status: 'pending', createdAt: 250, packageLabel: '100 EvoCash' },
]

test('listMyCashPurchasesPage returns only the caller own purchases, covering pending/credited/cancelled', async () => {
  const { api } = await service({ purchaseDocs: PURCHASE_DOCS })
  const { items } = await api.listMyCashPurchasesPage('alice')
  assert.deepEqual(
    items.map((item) => item.id),
    ['a1', 'a2', 'a3']
  )
  assert.deepEqual(
    items.map((item) => item.status).sort(),
    ['cancelled', 'credited', 'pending']
  )
})

test('listMyCashPurchasesPage for a different uid never returns another user purchases', async () => {
  const { api } = await service({ purchaseDocs: PURCHASE_DOCS })
  const { items } = await api.listMyCashPurchasesPage('bob')
  assert.deepEqual(
    items.map((item) => item.id),
    ['b1']
  )
})

test('listCashPurchasesForAdminPage filters by status when given, and returns everyone when status is empty', async () => {
  const { api } = await service({ purchaseDocs: PURCHASE_DOCS })
  const pending = await api.listCashPurchasesForAdminPage({ status: 'pending' })
  assert.deepEqual(
    pending.items.map((item) => item.id).sort(),
    ['a1', 'b1']
  )
  const all = await api.listCashPurchasesForAdminPage({ status: '' })
  assert.equal(all.items.length, 4)
})
