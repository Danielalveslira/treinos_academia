import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { freshDatabase, rawAll, withoutIndexedDb, workoutRow } from './testSupport.js'
import { purgePrivateData } from './userScope.js'
import { readCachedWorkouts, recordWorkoutsPage } from './historyCache.js'
import { readCachedUserExercises, replaceCachedUserExercises } from './userExercisesCache.js'
import {
  cacheCatalogEntries,
  cacheCatalogTaxonomy,
  readCachedCatalogEntry,
  readCachedCatalogTaxonomy,
} from './exerciseCache.js'

beforeEach(freshDatabase)

const NOW = Date.UTC(2026, 9, 5, 12)
const exerciseRow = (userId, id) => ({ user_id: userId, id, name: id, muscle_group: 'Peito' })

async function seed(userId) {
  await recordWorkoutsPage(userId, [workoutRow({ user_id: userId, id: `${userId}-w` })], {
    now: NOW,
  })
  await replaceCachedUserExercises(userId, [exerciseRow(userId, `${userId}-e`)])
}

async function seedPublic() {
  await cacheCatalogEntries([
    { id: 'c1', provider: 'p', providerExerciseId: 'x', name: 'Supino Reto' },
  ])
  await cacheCatalogTaxonomy({ muscles: ['peito'] })
}

test('logout (nenhum usuário): TODO dado privado some; o catálogo público permanece', async () => {
  await seed('user-a')
  await seed('user-b')
  await seedPublic()
  await purgePrivateData(null)
  assert.equal(await readCachedWorkouts('user-a'), undefined)
  assert.equal(await readCachedWorkouts('user-b'), undefined)
  assert.equal(await readCachedUserExercises('user-a'), undefined)
  assert.equal((await rawAll('workouts')).length, 0)
  assert.equal((await rawAll('userExercises')).length, 0)
  assert.deepEqual(
    (await rawAll('syncMeta')).map((m) => m.key),
    ['catalog:taxonomy']
  )
  assert.equal((await readCachedCatalogEntry({ catalogId: 'c1' })).name, 'Supino Reto')
  assert.deepEqual(await readCachedCatalogTaxonomy(), { muscles: ['peito'] })
})

test('troca de conta (A -> B): os dados de A saem, os de B ficam', async () => {
  await seed('user-a')
  await seed('user-b')
  await purgePrivateData('user-b')
  assert.equal(await readCachedWorkouts('user-a'), undefined)
  assert.equal(await readCachedUserExercises('user-a'), undefined)
  assert.deepEqual(
    (await readCachedWorkouts('user-b')).rows.map((r) => r.id),
    ['user-b-w']
  )
  assert.deepEqual(
    (await readCachedUserExercises('user-b')).map((e) => e.id),
    ['user-b-e']
  )
  assert.deepEqual(
    (await rawAll('workouts')).map((r) => r.user_id),
    ['user-b']
  )
  assert.deepEqual((await rawAll('syncMeta')).map((m) => m.key).sort(), [
    'user:user-b:exercises:syncedAt',
    'user:user-b:workouts:syncedAt',
  ])
})

test('login/boot com o MESMO usuário preserva o cache dele (é o que permite abrir offline depois)', async () => {
  await seed('user-a')
  await purgePrivateData('user-a')
  assert.equal((await readCachedWorkouts('user-a')).rows.length, 1)
  assert.equal((await readCachedUserExercises('user-a')).length, 1)
})

test('B logado depois de A sair nunca enxerga o histórico de A, mesmo sem a limpeza ter rodado ainda', async () => {
  await seed('user-a')
  // Sem purge: o isolamento já vem das chaves [user_id, id] e dos filtros de leitura.
  assert.equal(await readCachedWorkouts('user-b'), undefined)
  assert.equal(await readCachedUserExercises('user-b'), undefined)
})

test('ids de usuário parecidos não se confundem (prefixo): manter "user-1" não preserva "user-10"', async () => {
  await seed('user-1')
  await seed('user-10')
  await purgePrivateData('user-1')
  assert.equal(await readCachedWorkouts('user-10'), undefined)
  assert.ok(await readCachedWorkouts('user-1'))
  const metaKeys = (await rawAll('syncMeta')).map((m) => m.key)
  assert.ok(metaKeys.every((key) => key.startsWith('user:user-1:')))
})

test('gravação do usuário novo logo depois da limpeza não é apagada por ela (gate de escrita)', async () => {
  await seed('user-a')
  const purge = purgePrivateData(null) // sem await: a limpeza ainda está em curso
  const write = recordWorkoutsPage('user-b', [workoutRow({ user_id: 'user-b', id: 'b-w' })], {
    now: NOW,
  })
  await Promise.all([purge, write])
  assert.deepEqual(
    (await readCachedWorkouts('user-b')).rows.map((r) => r.id),
    ['b-w']
  )
  assert.equal(await readCachedWorkouts('user-a'), undefined)
})

test('limpeza repetida (várias abas recebendo o mesmo SIGNED_OUT) é idempotente', async () => {
  await seed('user-a')
  await Promise.all([purgePrivateData(null), purgePrivateData(null), purgePrivateData(null)])
  assert.equal((await rawAll('workouts')).length, 0)
})

test('IndexedDB indisponível: a limpeza não lança', async () => {
  const restore = withoutIndexedDb()
  try {
    await assert.doesNotReject(purgePrivateData(null))
    await assert.doesNotReject(purgePrivateData('user-a'))
  } finally {
    restore()
  }
})

function fakeCaches() {
  const store = new Map()
  return {
    store,
    open: async () => ({
      match: async (url) => store.get(String(url)),
      put: async (url, response) => void store.set(String(url), response),
      delete: async (url) => store.delete(String(url)),
    }),
  }
}

// Mesma string literal de exerciseImagePrep.js/service-worker.js (EXERCISE_IMAGE_MANIFEST_URL) --
// a chave usada de verdade é o path relativo, não uma URL absoluta.
const MANIFEST_KEY = '/__exercise-image-manifest__'

test('logout (nenhum usuário): o manifesto de imagens da rotina (Cache Storage) também é limpo', async () => {
  const fake = fakeCaches()
  globalThis.caches = fake
  try {
    fake.store.set(MANIFEST_KEY, new Response('{"paths":["x"]}'))
    await purgePrivateData(null)
    assert.equal(fake.store.has(MANIFEST_KEY), false)
  } finally {
    delete globalThis.caches
  }
})

test('troca de conta (A -> B, não é logout): o manifesto da rotina NÃO é limpo aqui -- as imagens são públicas, só a prioridade de eviction fica desatualizada até a próxima preparação', async () => {
  const fake = fakeCaches()
  globalThis.caches = fake
  try {
    fake.store.set(MANIFEST_KEY, new Response('{"paths":["x"]}'))
    await purgePrivateData('user-b')
    assert.equal(fake.store.has(MANIFEST_KEY), true)
  } finally {
    delete globalThis.caches
  }
})

test('AuthContext chama a limpeza a cada troca real de identidade, sem aguardá-la', () => {
  const source = readFileSync(new URL('../../contexts/AuthContext.jsx', import.meta.url), 'utf8')
  const loadSession = source.slice(
    source.indexOf('async function loadSession'),
    source.indexOf('const [profileResult')
  )
  // Com sessão (login/troca de usuário) limpa o cache dos OUTROS usuários; sem cold start também limpa no logout.
  assert.match(
    loadSession,
    /if \(supabaseUser \|\| !coldStart\) purgePrivateData\(supabaseUser\?\.id \?\? null\)/
  )
  // Com cold start ligado, "sem sessão" só limpa DEPOIS de decidir que não é entrada offline (expiração/rede
  // ruim não é logout: o logout explícito já desligou o bootstrap em authService).
  assert.match(loadSession, /purgePrivateData\(null\)/)
  assert.match(loadSession, /resolveOfflineEntry\(\)/)
  assert.ok(!/await\s+purgePrivateData/.test(source))
})
