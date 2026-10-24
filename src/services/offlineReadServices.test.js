import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { businessDayKey } from '../utils/businessDate.js'
import { build } from 'esbuild'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

// Integração dos serviços REAIS (workouts, exercícios pessoais, catálogo) com o cache local,
// usando um Supabase falso controlável. supabase/config.js não existe em node --test (precisa
// do Vite), então é trocado via esbuild, mesmo padrão de exerciseCatalogService.test.js.
const require = createRequire(import.meta.url)
let directory
let outfile
let api

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'offline-read-services-'))
  outfile = join(directory, 'bundle.cjs')
  await build({
    stdin: {
      contents: `
        export * as workouts from './workoutsService.js'
        export * as exercises from './exercisesService.js'
        export * as catalog from './exerciseCatalogService.js'
        export * as pageCache from '../utils/pageCache.js'
        export * as history from './offline/historyCache.js'
        export * as exerciseCache from './offline/exerciseCache.js'
        export * as scope from './offline/userScope.js'
        export { closeDatabase } from './offline/database.js'
        export { isLocalFallback } from './offline/localFallback.js'
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    bundle: true,
    write: true,
    outfile,
    platform: 'node',
    format: 'cjs',
    logLevel: 'error',
    plugins: [
      {
        name: 'supabase-config-stub',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/supabase\/config$/ }, (args) => ({
            path: args.path,
            namespace: 'stub',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: `
              const chain = (call) => new Proxy({}, {
                get(_, method) {
                  if (method === 'then') return (resolve, reject) => {
                    const result = globalThis.__result(call)
                    return Promise.resolve(result).then(resolve, reject)
                  }
                  return (...args) => { call.steps.push([method, ...args]); return chain(call) }
                },
              })
              export const supabase = {
                from: (table) => { const call = { kind: 'from', table, steps: [] }; globalThis.__calls.push(call); return chain(call) },
                rpc: (name, params) => { const call = { kind: 'rpc', name, params, steps: [] }; globalThis.__calls.push(call); return chain(call) },
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
  await rm(directory, { recursive: true, force: true })
})

const NOW = Date.now()
// Os treinos usam o dia de negócio de São Paulo, inclusive na janela em que UTC já virou.
const today = businessDayKey(NOW)
const NETWORK = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

const row = (userId, id, overrides = {}) => ({
  user_id: userId,
  id,
  exercise_id: 'ex-1',
  type: 'strength',
  set_details: [{ weight: 80, reps: 10 }],
  sets: 1,
  duration_minutes: null,
  distance_km: null,
  date: today,
  note: 'n',
  created_at: `${today}T10:00:00.000000+00:00`,
  ...overrides,
})

let online

beforeEach(async () => {
  await api.closeDatabase()
  globalThis.indexedDB = new IDBFactory()
  api.pageCache.clearPageCache()
  globalThis.__calls = []
  online = { error: null, handler: null }
  globalThis.__result = (call) =>
    online.handler ? online.handler(call) : { data: null, error: online.error }
})

const respond = (data) => (online.handler = () => ({ data, error: null }))
const fail = (error) => (online.handler = () => ({ data: null, error }))

// ---- Histórico (workouts) -------------------------------------------------------------

test('ONLINE (sem regressão): listWorkoutsPage consulta o servidor com os mesmos filtros/ordem e devolve o mesmo formato', async () => {
  respond([
    row('user-a', 'w1'),
    row('user-a', 'w2', { created_at: `${today}T09:00:00.000000+00:00` }),
  ])
  const page = await api.workouts.listWorkoutsPage('user-a', {
    exerciseId: 'ex-1',
    startDate: '2026-01-01',
    pageSize: 2,
  })
  assert.deepEqual(
    page.items.map((w) => w.id),
    ['w1', 'w2']
  )
  assert.equal(page.items[0].date, `${today}T12:00:00`)
  assert.deepEqual(page.nextCursor, { date: today, createdAt: `${today}T09:00:00.000000+00:00` })
  assert.equal(api.isLocalFallback(page), false)
  const [call] = globalThis.__calls
  assert.equal(call.table, 'workouts')
  const steps = call.steps.map(([name, ...args]) => `${name}(${args.join(',')})`)
  assert.deepEqual(steps, [
    'select(*)',
    'eq(user_id,user-a)',
    'order(date,[object Object])',
    'order(created_at,[object Object])',
    'limit(2)',
    'eq(exercise_id,ex-1)',
    'gte(date,2026-01-01)',
  ])
})

test('o resultado do servidor atualiza o IndexedDB em segundo plano', async () => {
  respond([row('user-a', 'w1')])
  await api.workouts.listWorkoutsPage('user-a')
  await settle()
  const cached = await api.history.readCachedWorkouts('user-a')
  assert.deepEqual(
    cached.rows.map((r) => r.id),
    ['w1']
  )
})

test('SEM REDE: a mesma chamada devolve o histórico local, mapeado igual ao online e marcado como fallback', async () => {
  respond([
    row('user-a', 'w1'),
    row('user-a', 'w2', { created_at: `${today}T09:00:00.000000+00:00` }),
  ])
  const onlinePage = await api.workouts.listWorkoutsPage('user-a')
  await settle()

  fail(NETWORK)
  const offlinePage = await api.workouts.listWorkoutsPage('user-a')
  assert.equal(api.isLocalFallback(offlinePage), true)
  assert.deepEqual(offlinePage.items, onlinePage.items) // mesma forma da UI, online ou não
  assert.equal(offlinePage.nextCursor, null)
})

test('SEM REDE: paginação com cursor funciona sobre o cache e um resultado local NÃO fica preso no pageCache', async () => {
  respond([
    row('user-a', 'w1'),
    row('user-a', 'w2', { created_at: `${today}T09:00:00.000000+00:00` }),
  ])
  await api.workouts.listWorkoutsPage('user-a', { pageSize: 5 })
  await settle()
  fail(NETWORK)
  const key = 'workouts:user-a::'
  const first = await api.pageCache.fetchCached(key, () =>
    api.workouts.listWorkoutsPage('user-a', { pageSize: 1 })
  )
  assert.deepEqual(
    first.items.map((w) => w.id),
    ['w1']
  )
  assert.ok(first.nextCursor)
  assert.equal(api.pageCache.getCached(key), undefined)
  // Rede volta: a próxima leitura vai ao servidor (não reaproveita o local por 5 minutos).
  respond([row('user-a', 'w1'), row('user-a', 'w9')])
  const fresh = await api.pageCache.fetchCached(key, () =>
    api.workouts.listWorkoutsPage('user-a', { pageSize: 5 })
  )
  assert.deepEqual(
    fresh.items.map((w) => w.id),
    ['w1', 'w9']
  )
})

test('SEM REDE e sem cache: o erro de rede ORIGINAL chega à UI como hoje', async () => {
  fail(NETWORK)
  await assert.rejects(api.workouts.listWorkoutsPage('user-a'), (error) => error === NETWORK)
})

test('NUNCA mascara erro de autenticação/autorização com cache', async () => {
  respond([row('user-a', 'w1')])
  await api.workouts.listWorkoutsPage('user-a')
  await settle()
  for (const error of [
    { code: 'PGRST301', message: 'JWT expired' },
    { code: '42501', message: 'permission denied' },
  ]) {
    fail(error)
    await assert.rejects(api.workouts.listWorkoutsPage('user-a'), (e) => e === error)
    await assert.rejects(api.workouts.listDashboardWorkouts('user-a'), (e) => e === error)
    await assert.rejects(api.exercises.listExercises('user-a'), (e) => e === error)
  }
})

test('NUNCA usa o cache de outro usuário: B sem rede não vê o histórico de A', async () => {
  respond([row('user-a', 'w1')])
  await api.workouts.listWorkoutsPage('user-a')
  await settle()
  fail(NETWORK)
  await assert.rejects(api.workouts.listWorkoutsPage('user-b'), (error) => error === NETWORK)
  assert.ok(await api.workouts.listWorkoutsPage('user-a')) // o dono continua lendo
})

test('dashboard e histórico por exercício: online atualizam o cache, sem rede leem do cache', async () => {
  respond([
    row('user-a', 'w1'),
    row('user-a', 'w2', { exercise_id: 'ex-2', created_at: `${today}T09:00:00.000000+00:00` }),
  ])
  const dash = await api.workouts.listDashboardWorkouts('user-a')
  assert.equal(dash.length, 2)
  await settle()
  fail(NETWORK)
  const offlineDash = await api.workouts.listDashboardWorkouts('user-a')
  assert.deepEqual(offlineDash, dash)
  assert.equal(api.isLocalFallback(offlineDash), true)
  const forExercise = await api.workouts.listWorkoutsForExercise('user-a', 'ex-2')
  assert.deepEqual(
    forExercise.map((w) => w.id),
    ['w2']
  )
})

test('create/update online guardam a linha devolvida; delete online a remove do cache', async () => {
  // O cache só é legível depois de uma página confirmada pelo servidor (uma linha avulsa não é o histórico).
  respond([row('user-a', 'base', { created_at: `${today}T08:00:00.000000+00:00` })])
  await api.workouts.listWorkoutsPage('user-a')
  await settle()

  const workout = {
    exerciseId: 'ex-1',
    date: today,
    note: '',
    type: 'strength',
    setDetails: [{ weight: '50', reps: '8' }],
  }
  respond(row('user-a', 'novo'))
  await api.workouts.createWorkout('user-a', workout)
  await settle()
  assert.deepEqual(
    (await api.history.readCachedWorkouts('user-a')).rows.map((r) => r.id),
    ['novo', 'base']
  )

  respond(row('user-a', 'novo', { set_details: [{ weight: 55, reps: 8 }] }))
  await api.workouts.updateWorkout('user-a', 'novo', workout)
  await settle()
  const [first] = (await api.history.readCachedWorkouts('user-a')).rows
  assert.deepEqual(first.set_details, [{ weight: 55, reps: 8 }])

  respond(null)
  await api.workouts.deleteWorkout('user-a', 'novo')
  await settle()
  assert.deepEqual(
    (await api.history.readCachedWorkouts('user-a')).rows.map((r) => r.id),
    ['base']
  )
})

test('falha do servidor ao gravar NÃO toca o cache (e o erro continua sendo lançado)', async () => {
  respond([row('user-a', 'w1')])
  await api.workouts.listWorkoutsPage('user-a')
  await settle()
  const error = { code: '23514', message: 'check violation' }
  fail(error)
  await assert.rejects(api.workouts.deleteWorkout('user-a', 'w1'), (e) => e === error)
  await settle()
  assert.deepEqual(
    (await api.history.readCachedWorkouts('user-a')).rows.map((r) => r.id),
    ['w1']
  )
})

// ---- Exercícios pessoais ------------------------------------------------------------

const exerciseRow = (userId, id, name) => ({
  user_id: userId,
  id,
  name,
  muscle_group: 'Peito',
  type: 'strength',
  note: '',
  active: true,
  source: 'custom',
  provider: null,
  provider_exercise_id: null,
  catalog_id: null,
  equipment: null,
  order: null,
})

test('exercícios pessoais: online grava, sem rede lê do cache (mesmo formato), outro usuário não lê', async () => {
  respond([exerciseRow('user-a', 'e2', 'Remada'), exerciseRow('user-a', 'e1', 'Agachamento')])
  const online = await api.exercises.listExercises('user-a')
  await settle()
  fail(NETWORK)
  const offline = await api.exercises.listExercises('user-a')
  assert.equal(api.isLocalFallback(offline), true)
  assert.deepEqual(
    offline.map((e) => e.name),
    ['Agachamento', 'Remada']
  )
  assert.deepEqual(
    [...offline].sort((a, b) => a.id.localeCompare(b.id)),
    [...online].sort((a, b) => a.id.localeCompare(b.id))
  )
  await assert.rejects(api.exercises.listExercises('user-b'), (e) => e === NETWORK)
})

// ---- Catálogo público -----------------------------------------------------------------

const catalogRow = (id, name, extra = {}) => ({
  id,
  provider: 'evolutus',
  provider_exercise_id: `ext-${id}`,
  name,
  primary_muscle: 'peito',
  muscles: ['peito', 'triceps'],
  equipment: 'barra',
  category: 'forca',
  difficulty: 'iniciante',
  force: 'push',
  mechanic: 'composto',
  instructions: ['a'],
  source_media_refs: { images: ['i.jpg'] },
  published_media_refs: { images: [] },
  total_count: 2,
  ...extra,
})

test('catálogo ONLINE (sem regressão): a RPC recebe os mesmos parâmetros e o formato mapeado é o mesmo', async () => {
  respond([catalogRow('c1', 'Supino Reto'), catalogRow('c2', 'Supino Inclinado')])
  const result = await api.catalog.searchExercises({
    q: 'supino',
    category: 'forca',
    limit: 20,
    offset: 0,
  })
  assert.equal(result.total, 2)
  assert.equal(result.data[0].providerExerciseId, 'ext-c1')
  assert.deepEqual(result.data[0].secondaryMuscles, ['triceps'])
  assert.deepEqual(globalThis.__calls[0].params, {
    p_query: 'supino',
    p_category: 'forca',
    p_equipment: null,
    p_muscle: null,
    p_difficulty: null,
    p_limit: 20,
    p_offset: 0,
  })
  assert.equal(api.isLocalFallback(result), false)
})

test('catálogo: sem rede, a busca cai no cache local (sem acento) e é marcada como fallback; sem cache, propaga o erro', async () => {
  fail(NETWORK)
  await assert.rejects(api.catalog.searchExercises({ q: 'supino' }), (e) => e === NETWORK)

  respond([
    catalogRow('c1', 'Supino Reto'),
    catalogRow('c2', 'Elevação Lateral', { primary_muscle: 'ombros', muscles: ['ombros'] }),
  ])
  await api.catalog.searchExercises({ q: 'a' })
  await settle()
  fail(NETWORK)
  const offline = await api.catalog.searchExercises({ q: 'elevacao' })
  assert.equal(api.isLocalFallback(offline), true)
  assert.deepEqual(
    offline.data.map((e) => e.name),
    ['Elevação Lateral']
  )
  assert.equal(offline.total, 1)
  // Não repete resultado antigo para busca que o cache não cobre.
  await assert.rejects(api.catalog.searchExercises({ q: 'zzz' }), (e) => e === NETWORK)
})

test('catálogo: auth/permissão não cai no cache', async () => {
  respond([catalogRow('c1', 'Supino Reto')])
  await api.catalog.searchExercises({ q: 'supino' })
  await settle()
  const error = { code: 'PGRST301', message: 'JWT expired' }
  fail(error)
  await assert.rejects(api.catalog.searchExercises({ q: 'supino' }), (e) => e === error)
})

test('catálogo: detalhe grava online; sem rede lê do cache; "não existe" (null) do servidor NÃO vira cache', async () => {
  respond(catalogRow('c1', 'Supino Reto'))
  const detail = await api.catalog.getExerciseDetail({ catalogId: 'c1' })
  assert.equal(detail.name, 'Supino Reto')
  await settle()
  fail(NETWORK)
  const offline = await api.catalog.getExerciseDetail({ catalogId: 'c1' })
  assert.deepEqual(offline, detail)
  assert.equal(api.isLocalFallback(offline), true)

  online.handler = () => ({ data: null, error: null }) // servidor: não existe mais
  assert.equal(await api.catalog.getExerciseDetail({ catalogId: 'c1' }), null)
})

test('catálogo: taxonomia grava online; sem rede (novo carregamento) vem do cache SEM ficar fixada na sessão', async () => {
  respond([{ muscles: ['peito'], equipment: 'barra', category: 'forca', difficulty: 'iniciante' }])
  const taxonomy = await api.catalog.listCatalogTaxonomy()
  assert.deepEqual(taxonomy.muscles, ['peito'])
  await settle()
  assert.deepEqual(await api.exerciseCache.readCachedCatalogTaxonomy(), taxonomy)

  // Novo carregamento do app: instância nova do módulo (a promise da sessão é por módulo).
  await api.closeDatabase()
  delete require.cache[outfile]
  const reloaded = require(outfile)
  fail(NETWORK)
  const offline = await reloaded.catalog.listCatalogTaxonomy()
  assert.deepEqual(offline, taxonomy)
  assert.equal(reloaded.isLocalFallback(offline), true)

  // A rede voltou: a próxima chamada vai ao servidor (o dado local não ficou fixado).
  const callsBefore = globalThis.__calls.length
  respond([
    {
      muscles: ['peito', 'costas'],
      equipment: 'barra',
      category: 'forca',
      difficulty: 'iniciante',
    },
  ])
  const fresh = await reloaded.catalog.listCatalogTaxonomy()
  assert.deepEqual(fresh.muscles, ['costas', 'peito'])
  assert.equal(globalThis.__calls.length, callsBefore + 1)
  assert.equal(reloaded.isLocalFallback(fresh), false)
  await reloaded.closeDatabase()
})

// ---- Sem IndexedDB ---------------------------------------------------------------------

test('SEM IndexedDB: o fluxo online funciona igual e a falha de rede propaga o erro original', async () => {
  await api.closeDatabase()
  globalThis.indexedDB = undefined
  try {
    respond([row('user-a', 'w1')])
    const page = await api.workouts.listWorkoutsPage('user-a')
    assert.deepEqual(
      page.items.map((w) => w.id),
      ['w1']
    )
    respond([exerciseRow('user-a', 'e1', 'Remada')])
    assert.equal((await api.exercises.listExercises('user-a')).length, 1)
    respond([catalogRow('c1', 'Supino Reto')])
    assert.equal((await api.catalog.searchExercises({ q: 'supino' })).data.length, 1)
    await api.workouts.deleteWorkout('user-a', 'w1')
    fail(NETWORK)
    await assert.rejects(api.workouts.listWorkoutsPage('user-a'), (e) => e === NETWORK)
    await assert.rejects(api.catalog.searchExercises({ q: 'supino' }), (e) => e === NETWORK)
  } finally {
    globalThis.indexedDB = new IDBFactory()
  }
})

// ---- Logout / troca de usuário ---------------------------------------------------------

test('logout: depois da limpeza, nem o dono nem outro usuário leem o histórico; catálogo público segue', async () => {
  respond([row('user-a', 'w1')])
  await api.workouts.listWorkoutsPage('user-a')
  respond([catalogRow('c1', 'Supino Reto')])
  await api.catalog.searchExercises({ q: 'supino' })
  await settle()
  await api.scope.purgePrivateData(null)
  fail(NETWORK)
  await assert.rejects(api.workouts.listWorkoutsPage('user-a'), (e) => e === NETWORK)
  await assert.rejects(api.workouts.listWorkoutsPage('user-b'), (e) => e === NETWORK)
  assert.equal((await api.catalog.searchExercises({ q: 'supino' })).data.length, 1) // público
})

test('official availability shares the personal list query and survives the private offline cache', async () => {
  respond([
    {
      ...exerciseRow('user-a', 'e1', 'Publicado'),
      source: 'catalog',
      provider: 'evolutus_dataset',
      catalog_id: 'c1',
      provider_exercise_id: 'pub',
      catalog: {
        id: 'c1',
        provider: 'evolutus_dataset',
        provider_exercise_id: 'pub',
        status: 'published',
      },
    },
    {
      ...exerciseRow('user-a', 'e2', 'Retirado'),
      source: 'catalog',
      provider: 'evolutus_dataset',
      catalog: null,
    },
  ])
  const online = await api.exercises.listExercises('user-a')
  await settle()
  assert.equal(online.find((row) => row.id === 'e1').catalogAvailable, true)
  assert.equal(online.find((row) => row.id === 'e2').catalogAvailable, false)
  fail(NETWORK)
  const offline = await api.exercises.listExercises('user-a', { localOnly: true })
  assert.equal(offline.find((row) => row.id === 'e1').catalogAvailable, true)
  assert.equal(offline.find((row) => row.id === 'e2').catalogAvailable, false)
})

test('links without catalog_id resolve by provider tuple in bounded batches and stay available offline', async () => {
  const rows = Array.from({ length: 85 }, (_, index) => ({
    ...exerciseRow('user-a', `e-${index}`, `Oficial ${index}`),
    source: 'catalog',
    provider: index === 1 ? 'evolutus_original' : 'evolutus_dataset',
    provider_exercise_id: index === 1 ? 'ref-0' : `ref-${index}`,
    catalog_id: null,
    catalog: null,
  }))
  const catalog = rows.slice(0, -1).map((row, index) => ({
    id: `cat-${index}`,
    provider: row.provider,
    provider_exercise_id: row.provider_exercise_id,
    status: 'published',
  }))
  online.handler = (call) => ({
    data:
      call.table === 'exercises'
        ? rows
        : catalog.filter((row) =>
            call.steps
              .find(([method, field]) => method === 'in' && field === 'provider_exercise_id')[2]
              .includes(row.provider_exercise_id)
          ),
    error: null,
  })
  const result = await api.exercises.listExercises('user-a')
  assert.equal(result.filter((row) => row.catalogAvailable).length, 84)
  assert.equal(
    result.find((row) => row.id === 'e-1').catalogAvailable,
    true,
    'provider is part of identity'
  )
  assert.equal(
    result.find((row) => row.id === 'e-84').catalogAvailable,
    false,
    'unresolved/hidden unpublished row is unavailable'
  )
  assert.equal(
    globalThis.__calls.filter((call) => call.table === 'exercise_catalog').length,
    3,
    '85 links use three bounded queries, never 85 queries'
  )
  assert.equal(
    result.every((row) => row.catalogId === null),
    true,
    'legacy identity is not rewritten'
  )
  await settle()
  const count = globalThis.__calls.length
  fail(NETWORK)
  const cached = await api.exercises.listExercises('user-a', { localOnly: true })
  assert.deepEqual(
    cached.map((row) => [row.id, row.catalogAvailable]),
    [...result]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => [row.id, row.catalogAvailable])
  )
  assert.equal(globalThis.__calls.length, count, 'offline mode never queries the catalog')
  await assert.rejects(api.exercises.listExercises('user-b', { localOnly: true }))
})

test('a joined published row cannot hide mismatching provider, external id or catalog_id', async () => {
  const base = {
    ...exerciseRow('user-a', 'valid', 'Valid'),
    source: 'catalog',
    provider: 'evolutus_dataset',
    provider_exercise_id: 'pub',
    catalog_id: 'c1',
  }
  const joined = {
    id: 'c1',
    provider: 'evolutus_dataset',
    provider_exercise_id: 'pub',
    status: 'published',
  }
  respond([
    { ...base, catalog: joined },
    ...[
      { provider: 'evolutus_original' },
      { provider_exercise_id: 'other' },
      { catalog_id: 'c2' },
    ].map((patch, index) => ({ ...base, ...patch, id: `invalid-${index}`, catalog: joined })),
    { ...base, id: 'unpublished', catalog: { ...joined, status: 'withdrawn' } },
  ])
  const result = await api.exercises.listExercises('user-a')
  assert.deepEqual(
    result.map((row) => row.catalogAvailable),
    [true, false, false, false, false]
  )
  assert.equal(globalThis.__calls.length, 1, 'FK links do not cause fallback requests')
})

test('failed batch lookup preserves the last confirmed private cache instead of persisting false availability', async () => {
  const row = {
    ...exerciseRow('user-a', 'old', 'Oficial'),
    source: 'catalog',
    provider: 'evolutus_dataset',
    provider_exercise_id: 'pub',
    catalog_id: null,
    catalog: null,
  }
  online.handler = (call) => ({
    data:
      call.table === 'exercises'
        ? [row]
        : [{ id: 'c1', provider: row.provider, provider_exercise_id: 'pub', status: 'published' }],
    error: null,
  })
  await api.exercises.listExercises('user-a')
  await settle()
  online.handler = (call) =>
    call.table === 'exercises' ? { data: [row], error: null } : { data: null, error: NETWORK }
  const fallback = await api.exercises.listExercises('user-a')
  assert.equal(api.isLocalFallback(fallback), true)
  assert.equal(fallback[0].catalogAvailable, true)
  await settle()
  assert.equal(
    (await api.exercises.listExercises('user-a', { localOnly: true }))[0].catalogAvailable,
    true
  )
})
