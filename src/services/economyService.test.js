import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Mesmo padrão de workoutsService.test.js: bundleia o service de verdade com esbuild,
// substituindo firebase/firestore, firebase/functions e firebase/config por fixtures em
// memória -- assim o teste exercita economyService.js real (cache, chaves, merge da
// resposta da callable), sem precisar de um app Firebase de verdade nem rede.
function fakeSessionStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size
    },
  }
}

async function service({ walletDocs = {}, voteDocs = {}, callableResults = {} } = {}) {
  const { outputFiles } = await build({
    entryPoints: ['src/services/economyService.js'],
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
                  export const httpsCallable = (app, name) => async () => ({ data: RESULTS[name] ?? null })
                `,
              }
            }
            // firebase/firestore:
            //   doc(db, 'users', uid, 'wallet', 'current') -> uid é o índice 2.
            //   doc(db, 'statuses', statusId, 'economyVotes', uid) -> statusId é o
            //   índice 2, uid é o índice 4 -- distinguidos pelo índice 1 (coleção raiz).
            // getDocs/query/where/documentId/collectionGroup: fixture mínima só o
            // bastante pra exercitar getMyEconomyVotesForStatuses de verdade (o filtro
            // "in" contra VOTES), sem simular o motor de consultas do Firestore inteiro.
            return {
              contents: `
                const WALLETS = ${JSON.stringify(walletDocs)}
                const VOTES = ${JSON.stringify(voteDocs)}
                export const doc = (...args) => args
                export const getDoc = async (ref) => {
                  globalThis.__getDocCalls = (globalThis.__getDocCalls || 0) + 1
                  if (ref[1] === 'users') {
                    const wallet = WALLETS[ref[2]]
                    return { exists: () => Boolean(wallet), data: () => wallet }
                  }
                  const vote = VOTES[ref[2] + ':' + ref[4]]
                  return { exists: () => Boolean(vote), data: () => vote }
                }
                export const documentId = () => 'DOCUMENT_ID'
                export const collectionGroup = (...args) => args
                export const query = (_base, whereClause) => whereClause
                export const where = (_field, _op, refs) => ({ refs })
                export const getDocs = async (whereClause) => {
                  globalThis.__getDocsCalls = (globalThis.__getDocsCalls || 0) + 1
                  const docs = whereClause.refs
                    .map((ref) => {
                      const vote = VOTES[ref[2] + ':' + ref[4]]
                      if (!vote) return null
                      return { ref: { parent: { parent: { id: ref[2] } } }, data: () => vote }
                    })
                    .filter(Boolean)
                  return { docs }
                }
              `,
            }
          })
        },
      },
    ],
  })
  globalThis.__getDocCalls = 0
  globalThis.__getDocsCalls = 0
  const api = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  )
  return {
    api,
    getDocCalls: () => globalThis.__getDocCalls,
    getDocsCalls: () => globalThis.__getDocsCalls,
  }
}

test('the session cache is isolated per uid: reading one uid never returns another uid cached/seeded balance', async () => {
  globalThis.sessionStorage = fakeSessionStorage()
  const { api } = await service({
    walletDocs: {
      alice: { coinBalance: 10, lifetimeCoinsEarned: 10, cashBalance: 0 },
      bob: { coinBalance: 99, lifetimeCoinsEarned: 99, cashBalance: 0 },
    },
  })
  const alice = await api.getWallet('alice')
  assert.equal(alice.coinBalance, 10)
  const bob = await api.getWallet('bob')
  assert.equal(bob.coinBalance, 99)
  // Relendo alice depois de ler bob -- nunca deveria ter sido substituída pela chave de bob.
  const aliceAgain = await api.getWallet('alice')
  assert.equal(aliceAgain.coinBalance, 10)
})

test('getWallet reuses the session cache on a second call, without rereading Firestore', async () => {
  globalThis.sessionStorage = fakeSessionStorage()
  const { api, getDocCalls } = await service({
    walletDocs: { alice: { coinBalance: 5, lifetimeCoinsEarned: 5, cashBalance: 0 } },
  })
  await api.getWallet('alice')
  await api.getWallet('alice')
  assert.equal(getDocCalls(), 1)
})

test('clearCachedWallet removes every cached wallet key, so a later read never returns stale data', async () => {
  const storage = fakeSessionStorage()
  globalThis.sessionStorage = storage
  const { api } = await service({
    walletDocs: { alice: { coinBalance: 1, lifetimeCoinsEarned: 1, cashBalance: 0 } },
  })
  await api.getWallet('alice')
  assert.notEqual(storage.getItem('wallet:alice'), null)
  api.clearCachedWallet(storage)
  assert.equal(storage.getItem('wallet:alice'), null)
})

test('after logout, the previous uid cache is gone and the next uid never sees it even without an explicit clear call', async () => {
  const storage = fakeSessionStorage()
  globalThis.sessionStorage = storage
  const { api } = await service({
    walletDocs: {
      alice: { coinBalance: 42, lifetimeCoinsEarned: 42, cashBalance: 0 },
    },
  })
  await api.getWallet('alice')
  api.clearCachedWallet(storage)
  // bob nunca existiu em WALLETS -- se a chave fosse compartilhada entre contas (bug),
  // bob herdaria o saldo 42 de alice. Isolamento por uid garante que ele sempre parte de zero.
  const bob = await api.getWallet('bob')
  assert.deepEqual(bob, { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 })
})

test('registerQualifiedActivity updates the local cache from the callable response, without an extra Firestore read', async () => {
  globalThis.sessionStorage = fakeSessionStorage()
  const { api, getDocCalls } = await service({
    walletDocs: { alice: { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 } },
    callableResults: { registerQualifiedActivity: { granted: true, rewardCoins: 3, activeMinutes: 31 } },
  })
  await api.getWallet('alice')
  const result = await api.registerQualifiedActivity('alice')
  assert.equal(result.granted, true)
  const updated = await api.getWallet('alice')
  assert.equal(updated.coinBalance, 3)
  assert.equal(updated.lifetimeCoinsEarned, 3)
  // 1 leitura para o getWallet inicial, nenhuma outra depois do crédito -- a atualização
  // veio da resposta da callable, não de reler o Firestore.
  assert.equal(getDocCalls(), 1)
})

test('an expired cache entry (older than the TTL) is treated as a miss and rereads Firestore', async () => {
  const storage = fakeSessionStorage()
  globalThis.sessionStorage = storage
  const { api, getDocCalls } = await service({
    walletDocs: { alice: { coinBalance: 20, lifetimeCoinsEarned: 20, cashBalance: 0 } },
  })
  // Escreve a entrada de cache já "velha" (mais de 5 minutos), simulando uma aba que
  // ficou aberta sem navegar -- sessionStorage sobrevive a isso, então sem um teto de
  // idade este valor nunca seria substituído.
  storage.setItem(
    'wallet:alice',
    JSON.stringify({
      wallet: { coinBalance: 999, lifetimeCoinsEarned: 999, cashBalance: 0 },
      cachedAtMs: Date.now() - 6 * 60 * 1000,
    })
  )
  const wallet = await api.getWallet('alice')
  assert.equal(wallet.coinBalance, 20, 'deveria ter descartado o valor expirado e relido o Firestore')
  assert.equal(getDocCalls(), 1)
})

test('a cache entry still within the TTL is reused as-is, without rereading Firestore', async () => {
  const storage = fakeSessionStorage()
  globalThis.sessionStorage = storage
  const { api, getDocCalls } = await service({
    walletDocs: { alice: { coinBalance: 20, lifetimeCoinsEarned: 20, cashBalance: 0 } },
  })
  storage.setItem(
    'wallet:alice',
    JSON.stringify({
      wallet: { coinBalance: 8, lifetimeCoinsEarned: 8, cashBalance: 0 },
      cachedAtMs: Date.now() - 60 * 1000,
    })
  )
  const wallet = await api.getWallet('alice')
  assert.equal(wallet.coinBalance, 8)
  assert.equal(getDocCalls(), 0)
})

test('registerQualifiedActivity leaves the cache untouched when the checkpoint is not granted', async () => {
  globalThis.sessionStorage = fakeSessionStorage()
  const { api } = await service({
    walletDocs: { alice: { coinBalance: 7, lifetimeCoinsEarned: 7, cashBalance: 0 } },
    callableResults: { registerQualifiedActivity: { granted: false, reason: 'too_soon' } },
  })
  await api.getWallet('alice')
  await api.registerQualifiedActivity('alice')
  const wallet = await api.getWallet('alice')
  assert.equal(wallet.coinBalance, 7)
})

test('getMyEconomyVotesForStatuses fetches every status in a single query (no N+1), returning only the ones actually voted on', async () => {
  const { api, getDocsCalls } = await service({
    voteDocs: {
      's1:alice': { userId: 'alice', authorId: 'bob', value: 1, charged: true },
      's3:alice': { userId: 'alice', authorId: 'carol', value: -1, charged: true },
    },
  })
  const votes = await api.getMyEconomyVotesForStatuses('alice', ['s1', 's2', 's3'])
  assert.deepEqual(Object.keys(votes).sort(), ['s1', 's3'])
  assert.equal(votes.s1.value, 1)
  assert.equal(votes.s3.value, -1)
  assert.equal('s2' in votes, false, 'ausência de voto nunca deveria virar uma chave')
  // 1 única consulta para as 3 publicações -- nunca 1 leitura por status.
  assert.equal(getDocsCalls(), 1)
})

test('getMyEconomyVotesForStatuses never confuses one uid votes with another (per-uid query)', async () => {
  const { api } = await service({
    voteDocs: { 's1:alice': { userId: 'alice', value: 1 } },
  })
  const votes = await api.getMyEconomyVotesForStatuses('bob', ['s1'])
  assert.deepEqual(votes, {})
})

test('getMyEconomyVotesForStatuses with an empty status list never queries Firestore', async () => {
  const { api, getDocsCalls } = await service()
  const votes = await api.getMyEconomyVotesForStatuses('alice', [])
  assert.deepEqual(votes, {})
  assert.equal(getDocsCalls(), 0)
})

test('getMyEconomyVotesForStatuses chunks beyond the Firestore `in` limit (30) into multiple queries', async () => {
  const voteDocs = {}
  const statusIds = []
  for (let i = 0; i < 35; i++) {
    const statusId = `s${i}`
    statusIds.push(statusId)
    voteDocs[`${statusId}:alice`] = { userId: 'alice', value: 1 }
  }
  const { api, getDocsCalls } = await service({ voteDocs })
  const votes = await api.getMyEconomyVotesForStatuses('alice', statusIds)
  assert.equal(Object.keys(votes).length, 35)
  assert.equal(getDocsCalls(), 2, '35 status ids > 30 (limite do `in`) deveria virar 2 consultas')
})

test('castVote decrements the cached wallet by costCoins when the vote is charged', async () => {
  globalThis.sessionStorage = fakeSessionStorage()
  const { api } = await service({
    walletDocs: { alice: { coinBalance: 10, lifetimeCoinsEarned: 10, cashBalance: 0 } },
    callableResults: { voteOnPost: { voted: true, action: 'create', charged: true, costCoins: 3 } },
  })
  await api.getWallet('alice')
  const result = await api.castVote('alice', 's1', 1)
  assert.equal(result.charged, true)
  const wallet = await api.getWallet('alice')
  assert.equal(wallet.coinBalance, 7)
  assert.equal(wallet.lifetimeCoinsEarned, 10, 'débito nunca deveria mexer em lifetimeCoinsEarned')
})

test('castVote never touches the cached wallet when the vote was not charged (switch/remove/noop)', async () => {
  globalThis.sessionStorage = fakeSessionStorage()
  const { api } = await service({
    walletDocs: { alice: { coinBalance: 7, lifetimeCoinsEarned: 10, cashBalance: 0 } },
    callableResults: { voteOnPost: { voted: true, action: 'switch', charged: false } },
  })
  await api.getWallet('alice')
  await api.castVote('alice', 's1', -1)
  const wallet = await api.getWallet('alice')
  assert.equal(wallet.coinBalance, 7)
})
