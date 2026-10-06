import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDatabase, rawOpen, withoutIndexedDb } from './testSupport.js'
import {
  OfflineStorageUnavailableError,
  attempt,
  closeDatabase,
  isOfflineReadEnabled,
  openDatabase,
  request,
  withTransaction,
} from './database.js'
import { DB_NAME, DB_VERSION, MIGRATIONS, STORES, runMigrations } from './schema.js'

beforeEach(freshDatabase)

test('cria evolutus-local-v1 na versão 3 com stores, chaves e índices do schema real', async () => {
  const db = await openDatabase()
  assert.ok(db)
  assert.equal(db.name, 'evolutus-local-v1')
  assert.equal(db.version, DB_VERSION)
  assert.equal(DB_VERSION, 3)
  assert.deepEqual([...db.objectStoreNames].sort(), [
    'exerciseCatalog',
    'offlineBootstrap',
    'outbox',
    'syncMeta',
    'userExercises',
    'workouts',
  ])

  const tx = db.transaction([...db.objectStoreNames], 'readonly')
  const info = (name) => {
    const store = tx.objectStore(name)
    return { keyPath: store.keyPath, indexes: [...store.indexNames].sort() }
  }
  assert.deepEqual(info('exerciseCatalog'), {
    keyPath: 'id',
    indexes: ['byCachedAt', 'byProvider'],
  })
  assert.deepEqual(info('userExercises'), { keyPath: ['user_id', 'id'], indexes: ['byUser'] })
  assert.deepEqual(info('workouts'), {
    keyPath: ['user_id', 'id'],
    indexes: ['byUser', 'byUserDate'],
  })
  assert.deepEqual(info('syncMeta'), { keyPath: 'key', indexes: [] })
  assert.deepEqual(info('offlineBootstrap'), { keyPath: 'user_id', indexes: [] })
  assert.deepEqual(info('outbox'), {
    keyPath: 'mutation_id',
    indexes: ['byUserEntity', 'byUserSeq'],
  })
  assert.equal(tx.objectStore('outbox').index('byUserSeq').unique, true)
  // O modelo real de treino não tem workout_sets/workoutExercises.
  for (const name of ['workoutSets', 'workoutExercises'])
    assert.ok(!db.objectStoreNames.contains(name))
  assert.deepEqual(Object.values(STORES).sort(), [...db.objectStoreNames].sort())
})

test('reabrir devolve a mesma conexão e preserva os dados', async () => {
  const first = await openDatabase()
  await withTransaction([STORES.syncMeta], 'readwrite', ({ syncMeta }) =>
    request(syncMeta.put({ key: 'k', value: 1 }))
  )
  assert.equal(await openDatabase(), first)
  await closeDatabase()
  const value = await withTransaction([STORES.syncMeta], 'readonly', ({ syncMeta }) =>
    request(syncMeta.get('k'))
  )
  assert.deepEqual(value, { key: 'k', value: 1 })
})

test('upgrade: uma migration nova roda a partir da versão antiga, preserva os dados e cria a store nova', async () => {
  await openDatabase()
  await withTransaction([STORES.syncMeta], 'readwrite', ({ syncMeta }) =>
    request(syncMeta.put({ key: 'keep', value: 'me' }))
  )
  await closeDatabase()

  const addExtra = (database) => database.createObjectStore('extra', { keyPath: 'id' })
  MIGRATIONS.push(addExtra)
  try {
    const upgraded = await new Promise((resolve, reject) => {
      const open = globalThis.indexedDB.open(DB_NAME, MIGRATIONS.length)
      open.onupgradeneeded = (event) =>
        runMigrations(open.result, open.transaction, event.oldVersion, event.newVersion)
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    assert.equal(upgraded.version, 4)
    assert.ok(upgraded.objectStoreNames.contains('extra'))
    assert.ok(upgraded.objectStoreNames.contains('outbox'))
    const kept = await new Promise((resolve) => {
      const get = upgraded.transaction('syncMeta').objectStore('syncMeta').get('keep')
      get.onsuccess = () => resolve(get.result)
    })
    assert.deepEqual(kept, { key: 'keep', value: 'me' })
    upgraded.close()
  } finally {
    MIGRATIONS.pop()
  }
})

test('upgrade REAL v1 -> v3: as migrations das Fases 3 e 4 só ADICIONAM stores e preservam todos os dados da Fase 2', async () => {
  // Banco exatamente como a Fase 2 deixou (só a migration 1), com dados de cada store.
  await new Promise((resolve, reject) => {
    const open = globalThis.indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = (event) =>
      runMigrations(open.result, open.transaction, event.oldVersion, 1)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(
        ['exerciseCatalog', 'userExercises', 'workouts', 'syncMeta'],
        'readwrite'
      )
      tx.objectStore('exerciseCatalog').put({
        id: 'c1',
        name: 'Supino',
        provider: 'p',
        providerExerciseId: 'x',
        cachedAt: 1,
      })
      tx.objectStore('userExercises').put({ user_id: 'user-a', id: 'e1', name: 'Remada' })
      tx.objectStore('workouts').put({
        user_id: 'user-a',
        id: 'w1',
        date: '2026-10-05',
        created_at: '2026-10-05T10:00:00+00:00',
      })
      tx.objectStore('syncMeta').put({ key: 'user:user-a:workouts:syncedAt', value: 1 })
      tx.oncomplete = () => {
        assert.equal(db.version, 1)
        assert.ok(!db.objectStoreNames.contains('outbox'))
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    open.onerror = () => reject(open.error)
  })

  const db = await openDatabase()
  assert.equal(db.version, DB_VERSION) // sobe passo a passo: v1 -> v2 (outbox) -> v3 (bootstrap)
  assert.ok(db.objectStoreNames.contains('outbox'))
  assert.ok(db.objectStoreNames.contains('offlineBootstrap'))
  const read = (store, key) =>
    withTransaction([store], 'readonly', (stores) => request(stores[store].get(key)))
  assert.equal((await read('exerciseCatalog', 'c1')).name, 'Supino')
  assert.equal((await read('userExercises', ['user-a', 'e1'])).name, 'Remada')
  assert.equal((await read('workouts', ['user-a', 'w1'])).date, '2026-10-05')
  assert.equal((await read('syncMeta', 'user:user-a:workouts:syncedAt')).value, 1)
  assert.equal(
    await withTransaction(['outbox'], 'readonly', ({ outbox }) => request(outbox.count())),
    0
  )
})

test('upgrade REAL v2 -> v3: a migration da Fase 4 só ADICIONA o bootstrap e preserva outbox e caches', async () => {
  // Banco exatamente como a Fase 3 deixou (migrations 1 e 2), com uma mutação pendente e um registro de cache.
  await new Promise((resolve, reject) => {
    const open = globalThis.indexedDB.open(DB_NAME, 2)
    open.onupgradeneeded = (event) =>
      runMigrations(open.result, open.transaction, event.oldVersion, 2)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(['outbox', 'workouts'], 'readwrite')
      tx.objectStore('outbox').put({
        mutation_id: 'm1',
        user_id: 'user-a',
        seq: 1,
        entity_id: 'e1',
        operation: 'workout.create',
        payload: { x: 1 },
        status: 'pending',
      })
      tx.objectStore('workouts').put({
        user_id: 'user-a',
        id: 'w1',
        date: '2026-10-05',
        created_at: '2026-10-05T10:00:00+00:00',
      })
      tx.oncomplete = () => {
        assert.equal(db.version, 2)
        assert.ok(!db.objectStoreNames.contains('offlineBootstrap'))
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    open.onerror = () => reject(open.error)
  })
  const db = await openDatabase()
  assert.equal(db.version, 3)
  assert.ok(db.objectStoreNames.contains('offlineBootstrap'))
  const read = (store, key) =>
    withTransaction([store], 'readonly', (stores) => request(stores[store].get(key)))
  assert.equal((await read('outbox', 'm1')).payload.x, 1)
  assert.equal((await read('workouts', ['user-a', 'w1'])).date, '2026-10-05')
  assert.equal(
    await withTransaction(['offlineBootstrap'], 'readonly', ({ offlineBootstrap }) =>
      request(offlineBootstrap.count())
    ),
    0
  )
})

test('runMigrations não faz nada quando já está na versão atual', () => {
  const db = { createObjectStore: () => assert.fail('não deveria criar nada') }
  runMigrations(db, null, DB_VERSION, DB_VERSION)
})

test('migration que falha aborta a criação: o app segue sem cache e nada fica pela metade', async () => {
  const original = MIGRATIONS[0]
  MIGRATIONS[0] = () => {
    throw new Error('boom')
  }
  const { error, warn } = console
  console.error = console.warn = () => {}
  try {
    assert.equal(await openDatabase(), null)
  } finally {
    Object.assign(console, { error, warn })
    MIGRATIONS[0] = original
  }
  const raw = await rawOpen('evolutus-local-v1')
  assert.equal(raw.objectStoreNames.length, 0)
  raw.close()
})

test('banco mais novo que o código (rollback de deploy): não abre, não apaga nada', async () => {
  const future = await new Promise((resolve) => {
    const open = globalThis.indexedDB.open(DB_NAME, 7)
    open.onupgradeneeded = () => open.result.createObjectStore('futuro', { keyPath: 'id' })
    open.onsuccess = () => resolve(open.result)
  })
  future.close()
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(await openDatabase(), null)
  } finally {
    console.warn = warn
  }
  const raw = await rawOpen()
  assert.equal(raw.version, 7)
  assert.ok(raw.objectStoreNames.contains('futuro'))
  raw.close()
})

test('IndexedDB ausente: openDatabase devolve null, withTransaction falha de forma tipada e attempt degrada', async () => {
  const restore = withoutIndexedDb()
  try {
    assert.equal(await openDatabase(), null)
    await assert.rejects(
      withTransaction([STORES.syncMeta], 'readonly', () => {}),
      OfflineStorageUnavailableError
    )
    assert.equal(
      await attempt(
        't',
        () => withTransaction([STORES.syncMeta], 'readonly', () => {}),
        'fallback'
      ),
      'fallback'
    )
  } finally {
    restore()
  }
})

test('indexedDB.open que lança: null, e não martela o navegador a cada chamada (cooldown)', async () => {
  let opens = 0
  globalThis.indexedDB = {
    open() {
      opens += 1
      throw new DOMException('nope', 'SecurityError')
    },
  }
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(await openDatabase(), null)
    assert.equal(await openDatabase(), null)
    assert.equal(await openDatabase(), null)
  } finally {
    console.warn = warn
  }
  assert.equal(opens, 1)
})

test('flag VITE_OFFLINE_READ_ENABLED=false desliga o banco local; qualquer outro valor mantém ligado', async () => {
  assert.equal(isOfflineReadEnabled({ VITE_OFFLINE_READ_ENABLED: 'false' }), false)
  assert.equal(isOfflineReadEnabled({ VITE_OFFLINE_READ_ENABLED: 'true' }), true)
  assert.equal(isOfflineReadEnabled({}), true)
  assert.equal(isOfflineReadEnabled(undefined), true)
})

test('withTransaction: resolve só após confirmar e aborta tudo se o trabalho falhar', async () => {
  const written = await withTransaction([STORES.syncMeta], 'readwrite', ({ syncMeta }) => {
    syncMeta.put({ key: 'a', value: 1 })
    return 'ok'
  })
  assert.equal(written, 'ok')

  await assert.rejects(
    withTransaction([STORES.syncMeta], 'readwrite', async ({ syncMeta }) => {
      syncMeta.put({ key: 'b', value: 2 })
      throw new Error('falhou no meio')
    }),
    /falhou no meio/
  )
  const keys = await withTransaction([STORES.syncMeta], 'readonly', ({ syncMeta }) =>
    request(syncMeta.getAllKeys())
  )
  assert.deepEqual(keys, ['a'])
})

test('attempt registra a falha só uma vez por rótulo e nunca propaga', async () => {
  const warn = console.warn
  const calls = []
  console.warn = (...args) => calls.push(args)
  try {
    const boom = () => Promise.reject(new Error('dados privados no texto'))
    assert.equal(await attempt('rotulo-unico', boom, 1), 1)
    assert.equal(await attempt('rotulo-unico', boom, 2), 2)
  } finally {
    console.warn = warn
  }
  assert.equal(calls.length, 1)
  assert.ok(!JSON.stringify(calls).includes('dados privados'))
})
