import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { freshDatabase, rawAll } from './testSupport.js'
import { OfflineStorageUnavailableError, closeDatabase, openDatabase } from './database.js'
import { DB_NAME, DB_VERSION, MIGRATIONS, runMigrations } from './schema.js'
import {
  OPERATIONS,
  STATUS,
  claimNextBatch,
  enqueueWorkoutMutation,
  failMutation,
  listMutations,
  recoverStaleSyncing,
  releaseMutations,
} from './outbox.js'
import { purgePrivateData } from './userScope.js'

// Atualizar a PWA (novo build + novo Service Worker + possivelmente novo schema do IndexedDB) com a
// outbox cheia nunca pode apagar, reordenar, duplicar nem travar o trabalho do usuário.
beforeEach(freshDatabase)

const A = 'user-a'
const NOW = Date.UTC(2026, 9, 5, 12)
const payload = (weight) => ({
  exercise_id: 'ex-1',
  date: '2026-10-05',
  type: 'strength',
  set_details: [{ weight, reps: 10 }],
  sets: 1,
  duration_minutes: null,
  distance_km: null,
  note: '',
})
const enqueue = (entityId, weight, operation = OPERATIONS.create) =>
  enqueueWorkoutMutation(A, {
    operation,
    entityId,
    payload: operation === OPERATIONS.delete ? null : payload(weight),
    now: NOW,
  })

// Uma outbox "de verdade": pendente com espera, falha com a linha do servidor, e uma em andamento.
async function populate() {
  await enqueue('e1', 10)
  await enqueue('e2', 20)
  await enqueue('e3', 30)
  const [m1, m2, m3] = await listMutations(A)
  await claimNextBatch(A, { now: NOW, limit: 1 }) // m1 syncing
  await claimNextBatch(A, { now: NOW, limit: 1 }) // m2 syncing
  await releaseMutations(A, [m2.mutation_id], { now: NOW, random: () => 0.5 }) // m2 pending com backoff
  await failMutation(
    A,
    m3.mutation_id,
    { code: 'CONFLICT', serverRow: { user_id: A, id: 'e3', updated_at: 'v9' } },
    NOW
  )
  return { m1, m2, m3 }
}

test('ATUALIZAÇÃO com o MESMO schema (reload/novo build): a outbox volta idêntica — ids, payloads, seq, status e erros', async () => {
  await populate()
  const before = await rawAll('outbox')
  assert.equal(before.length, 3)
  await closeDatabase() // a página recarregou: nada em memória
  const after = await listMutations(A)
  assert.deepEqual(
    after,
    before.sort((a, b) => a.seq - b.seq)
  )
  assert.deepEqual(
    after.map((m) => m.seq),
    [1, 2, 3]
  )
  assert.equal(new Set(after.map((m) => m.mutation_id)).size, 3) // ids únicos e inalterados
})

test('depois da atualização o seq CONTINUA do maior e nenhuma mutação é duplicada ou reordenada', async () => {
  const { m1 } = await populate()
  await closeDatabase()
  const next = await enqueue('e4', 40)
  const all = await listMutations(A)
  assert.deepEqual(
    all.map((m) => m.seq),
    [1, 2, 3, 4]
  )
  assert.equal(all[3].mutation_id, next.mutation_id)
  assert.equal(all[0].mutation_id, m1.mutation_id)
  assert.equal(all.length, 4) // nada duplicado
  // compactação continua funcionando sobre uma mutação que já existia antes da atualização
  await enqueue('e2', 21, OPERATIONS.update)
  assert.equal((await listMutations(A)).length, 4)
})

test('o syncing deixado pela atualização NÃO fica eterno: é recuperado, a tentativa conta e o backoff é respeitado', async () => {
  const { m1 } = await populate() // m1 ficou syncing (aba fechou/atualizou no meio do envio)
  await closeDatabase()
  assert.equal(
    (await listMutations(A)).find((m) => m.mutation_id === m1.mutation_id).status,
    STATUS.syncing
  )
  await recoverStaleSyncing(A, NOW)
  const recovered = (await listMutations(A)).find((m) => m.mutation_id === m1.mutation_id)
  assert.equal(recovered.status, STATUS.pending)
  assert.equal(recovered.attempts, 1)
  assert.equal(recovered.payload.set_details[0].weight, 10) // payload intacto
  // As que já estavam em espera/falhas continuam como estavam.
  const all = await listMutations(A)
  assert.equal(all.find((m) => m.entity_id === 'e2').status, STATUS.pending)
  assert.ok(all.find((m) => m.entity_id === 'e2').next_attempt_at > NOW)
  assert.equal(all.find((m) => m.entity_id === 'e3').status, STATUS.failed)
})

test('UPGRADE de schema futuro (v3) com outbox cheia: tudo preservado, índices intactos, nada travado', async () => {
  await populate()
  const before = await rawAll('outbox')
  await closeDatabase()
  const addTelemetry = (db) => db.createObjectStore('telemetry', { keyPath: 'id' })
  MIGRATIONS.push(addTelemetry)
  try {
    const upgraded = await new Promise((resolve, reject) => {
      const open = globalThis.indexedDB.open(DB_NAME, MIGRATIONS.length)
      open.onupgradeneeded = (event) =>
        runMigrations(open.result, open.transaction, event.oldVersion, event.newVersion)
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    assert.equal(upgraded.version, DB_VERSION + 1)
    const tx = upgraded.transaction('outbox')
    assert.deepEqual([...tx.objectStore('outbox').indexNames].sort(), ['byUserEntity', 'byUserSeq'])
    assert.equal(tx.objectStore('outbox').index('byUserSeq').unique, true)
    upgraded.close()
  } finally {
    MIGRATIONS.pop()
  }
  assert.deepEqual(
    (await rawAll('outbox')).sort((a, b) => a.seq - b.seq),
    before.sort((a, b) => a.seq - b.seq)
  )
})

test('ABA ANTIGA aberta durante o upgrade de outra: libera a conexão (não trava o upgrade) e depois degrada sem perder nada', async () => {
  await populate()
  const before = await rawAll('outbox')
  const oldTab = await openDatabase() // a aba antiga segura uma conexão v2
  assert.ok(oldTab)
  let versionChangeSeen = false
  oldTab.addEventListener('versionchange', () => {
    versionChangeSeen = true
  })
  MIGRATIONS.push((db) => db.createObjectStore('telemetry', { keyPath: 'id' }))
  try {
    // A aba NOVA pede o upgrade para v3: se a antiga não fechasse, isto ficaria pendurado.
    const upgrade = await Promise.race([
      new Promise((resolve, reject) => {
        const open = globalThis.indexedDB.open(DB_NAME, MIGRATIONS.length)
        open.onupgradeneeded = (event) =>
          runMigrations(open.result, open.transaction, event.oldVersion, event.newVersion)
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
      }),
      new Promise((resolve) => setTimeout(() => resolve('travou'), 2000)),
    ])
    assert.notEqual(upgrade, 'travou')
    assert.equal(versionChangeSeen, true)
    upgrade.close()
  } finally {
    MIGRATIONS.pop()
  }
  // A aba antiga (código v2) agora encontra um banco MAIS NOVO: não abre, não apaga, não escreve.
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.deepEqual(await listMutations(A), []) // leitura degrada para "sem dados"
    await assert.rejects(enqueue('e9', 90), OfflineStorageUnavailableError) // não finge que salvou
    assert.equal(await purgePrivateData(null), undefined) // nem a limpeza consegue (e não lança)
  } finally {
    console.warn = warn
  }
  assert.deepEqual(
    (await rawAll('outbox')).sort((a, b) => a.seq - b.seq),
    before.sort((a, b) => a.seq - b.seq)
  )
})

test('a limpeza de cache de uma atualização/logout nunca remove mutações pendentes', async () => {
  await populate()
  const before = await rawAll('outbox')
  await purgePrivateData(null)
  await purgePrivateData('outro-usuario')
  assert.deepEqual(
    (await rawAll('outbox')).sort((a, b) => a.seq - b.seq),
    before.sort((a, b) => a.seq - b.seq)
  )
})

test('banco v2 sem nada de outbox (usuário que vem da Fase 2) abre e cria a store sem tocar nos caches', async () => {
  const db = await rawOpenAtV1()
  assert.equal(db.version, 1)
  db.close()
  const upgraded = await openDatabase()
  assert.equal(upgraded.version, DB_VERSION)
  assert.ok(upgraded.objectStoreNames.contains('outbox'))
  assert.deepEqual(await listMutations(A), [])
})

async function rawOpenAtV1() {
  return new Promise((resolve, reject) => {
    const open = globalThis.indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = (event) =>
      runMigrations(open.result, open.transaction, event.oldVersion, 1)
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}

// ------------------------------------------------------------------------------------ Service Worker

test('o Service Worker NÃO toca IndexedDB, localStorage nem a outbox: atualizar o SW não pode apagar nada do usuário', () => {
  const sw = readFileSync(new URL('../../../scripts/service-worker.js', import.meta.url), 'utf8')
  assert.ok(
    !/indexedDB|IDB(Database|Factory|KeyRange)|deleteDatabase|localStorage|sessionStorage|outbox|evolutus-local/.test(
      sw
    )
  )
  // O único estado que ele apaga são os caches DELE (prefixo próprio), no activate.
  assert.match(sw, /const OWNED_PREFIX = 'treinos-'/)
  assert.match(sw, /key\.startsWith\(OWNED_PREFIX\)/)
  // E nunca intercepta o Supabase nem qualquer origem diferente (o sync usa fetch direto da página).
  assert.match(sw, /url\.origin !== self\.location\.origin\) return/)
  assert.match(sw, /request\.method !== 'GET'/)
})

test('o plugin de PWA não coloca nada de dados no precache (só shell e boot assets)', () => {
  const plugin = readFileSync(new URL('../../../scripts/pwa-plugin.js', import.meta.url), 'utf8')
  assert.ok(
    !/indexedDB|outbox|supabase\.co/i.test(plugin.replace(/pushAckConfig[\s\S]*?\n}\n/, ''))
  )
})
