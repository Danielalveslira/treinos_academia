import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { makeServer } from './offline/syncTestKit.js'

// Serviços REAIS de gravação (workouts/exercícios) + scheduler/engine, com Supabase falso e a flag
// VITE_OFFLINE_WRITE_ENABLED ligada (bundle ON) e desligada/ausente (bundle OFF).
const require = createRequire(import.meta.url)
let directory
let on
let off

async function bundle(name, env) {
  const outfile = join(directory, `${name}.cjs`)
  await build({
    stdin: {
      contents: `
        export * as workouts from './workoutsService.js'
        export * as exercises from './exercisesService.js'
        export * as pageCache from '../utils/pageCache.js'
        export * as outbox from './offline/outbox.js'
        export * as history from './offline/historyCache.js'
        export * as userExercises from './offline/userExercisesCache.js'
        export * as scope from './offline/userScope.js'
        export * as scheduler from './offline/syncScheduler.js'
        export * as status from './offline/syncStatusStore.js'
        export * as actions from './offline/syncActions.js'
        export * as notice from './offline/pendingNotice.js'
        export { closeDatabase, isOfflineWriteEnabled } from './offline/database.js'
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
    define: { 'import.meta.env': JSON.stringify(env) },
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
                  if (method === 'then') return (resolve, reject) => Promise.resolve(globalThis.__respond(call)).then(resolve, reject)
                  return (...args) => { call.steps.push([method, ...args]); return chain(call) }
                },
              })
              export const supabase = {
                from: (table) => { const call = { kind: 'from', table, steps: [] }; globalThis.__calls.push(call); return chain(call) },
                rpc: (name, params) => { const call = { kind: 'rpc', name, params, steps: [] }; globalThis.__calls.push(call); return chain(call) },
                auth: { getSession: async () => ({ data: { session: globalThis.__session } }) },
              }
            `,
          }))
        },
      },
    ],
  })
  return require(outfile)
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'offline-write-services-'))
  on = await bundle('on', { VITE_OFFLINE_WRITE_ENABLED: 'true' })
  off = await bundle('off', {})
})

after(async () => {
  await on.closeDatabase()
  await off.closeDatabase()
  await rm(directory, { recursive: true, force: true })
})

const A = 'c3000000-0000-0000-0000-000000000001'
const B = 'c3000000-0000-0000-0000-000000000002'
const EX = 'c3e00000-0000-0000-0000-000000000001'
const NETWORK = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }
const today = '2026-10-05'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const form = (weight = '80') => ({
  exerciseId: EX,
  date: today,
  note: '',
  type: 'strength',
  setDetails: [{ weight, reps: '10' }],
})

let respond
let server
let originalNavigator

function setNavigator(onLine) {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true })
}

beforeEach(async () => {
  await on.closeDatabase()
  await off.closeDatabase()
  globalThis.indexedDB = new IDBFactory()
  on.pageCache.clearPageCache()
  on.status.resetSyncStatusForTests()
  globalThis.__calls = []
  globalThis.__session = { user: { id: A } }
  server = makeServer()
  respond = { network: false, rpcDown: false, rpc: null, error: null, data: null, fn: null }
  globalThis.__respond = (call) => {
    if (call.kind === 'rpc' && call.name === 'sync_workout_mutations') {
      if (respond.network || respond.rpcDown) return { data: null, error: NETWORK }
      return {
        data: server.apply(globalThis.__session.user.id, call.params.p_mutations),
        error: null,
      }
    }
    if (respond.fn) {
      const handled = respond.fn(call)
      if (handled !== undefined) return handled
    }
    if (respond.network) return { data: null, error: NETWORK }
    if (respond.error) return { data: null, error: respond.error }
    const row = respond.data
    return { data: typeof row === 'function' ? row(call) : row, error: null }
  }
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  setNavigator(true)
})

import { afterEach } from 'node:test'
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else delete globalThis.navigator
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 40))
const serverRowFrom = (call) => {
  const insert = call.steps.find(([m]) => m === 'insert')?.[1]
  return {
    ...insert,
    created_at: '2026-10-05T13:00:00.000000+00:00',
    updated_at: '2026-10-05T13:00:00.000000+00:00',
  }
}

// ============================================================================ flag LIGADA

test('flag ligada + ONLINE: o INSERT leva o id gerado no cliente, o servidor confirma e NADA vai para a outbox', async () => {
  respond.data = serverRowFrom
  const result = await on.workouts.createWorkout(A, form())
  assert.equal(result.synced, true)
  assert.equal(result.pendingSync, false)
  assert.equal(result.persisted, true)
  const insert = globalThis.__calls[0].steps.find(([m]) => m === 'insert')[1]
  assert.match(insert.id, UUID)
  assert.equal(insert.user_id, A)
  assert.equal(result.workout.id, insert.id)
  assert.deepEqual(await on.outbox.listMutations(A), [])
  await settle()
  assert.equal((await on.history.readCachedWorkoutRow(A, insert.id)).id, insert.id) // cache atualizado após o sucesso
})

test('flag ligada + OFFLINE: salva no aparelho + outbox e diz CLARAMENTE que não sincronizou', async () => {
  setNavigator(false)
  const result = await on.workouts.createWorkout(A, form('82.5'))
  assert.deepEqual(
    { persisted: result.persisted, synced: result.synced, pendingSync: result.pendingSync },
    { persisted: true, synced: false, pendingSync: true }
  )
  assert.equal(globalThis.__calls.filter((c) => c.kind === 'from').length, 0) // nem tentou a rede
  const [m] = await on.outbox.listMutations(A)
  assert.equal(m.operation, 'workout.create')
  assert.equal(m.entity_id, result.workout.id) // mesmo id, sem mapa local->remoto
  assert.deepEqual(m.payload.set_details, [{ weight: 82.5, reps: 10 }])
  assert.equal((await on.history.readCachedWorkoutRow(A, m.entity_id)).sets, 1)
})

test('flag ligada: o ESTADO do servidor não é simulado — a outbox guarda o payload, nunca tokens, headers nem user_id', async () => {
  setNavigator(false)
  await on.workouts.createWorkout(A, form())
  const [m] = await on.outbox.listMutations(A)
  const text = JSON.stringify(m)
  assert.ok(!/authorization|bearer|token|apikey|headers|url/i.test(text))
  assert.ok(!('user_id' in m.payload))
})

test('online MAS a rede falha no INSERT (resposta pode ter se perdido): cai para a fila com o MESMO id que foi enviado', async () => {
  respond.network = true
  const result = await on.workouts.createWorkout(A, form())
  assert.equal(result.synced, false)
  assert.equal(result.pendingSync, true)
  const attemptedId = globalThis.__calls[0].steps.find(([m]) => m === 'insert')[1].id
  const [m] = await on.outbox.listMutations(A)
  assert.equal(m.entity_id, attemptedId) // se o servidor aplicou, o sync resolve como já-aplicado
})

test('erro que NÃO é de conectividade (validação/permissão) continua sendo erro: nada vai para a fila', async () => {
  for (const error of [
    { code: '23514', message: 'check violation' },
    { code: '42501', message: 'permission denied' },
    { code: 'PGRST301', message: 'JWT expired' },
  ]) {
    respond.error = error
    await assert.rejects(on.workouts.createWorkout(A, form()), (e) => e === error)
    await assert.rejects(on.workouts.updateWorkout(A, 'w1', form()), (e) => e === error)
    await assert.rejects(on.workouts.deleteWorkout(A, 'w1'), (e) => e === error)
  }
  assert.deepEqual(await on.outbox.listMutations(A), [])
})

test('registro inválido é recusado ANTES de qualquer coisa: nem rede, nem fila', async () => {
  setNavigator(false)
  await assert.rejects(
    on.workouts.createWorkout(A, { ...form(), setDetails: [{ weight: '-1', reps: '10' }] }),
    /inválido/
  )
  assert.deepEqual(await on.outbox.listMutations(A), [])
})

test('update e delete OFFLINE entram na fila com a versão-base que este aparelho viu', async () => {
  const serverRow = {
    user_id: A,
    id: 'w-srv',
    exercise_id: EX,
    type: 'strength',
    set_details: [{ weight: 50, reps: 5 }],
    sets: 1,
    date: today,
    note: '',
    created_at: '2026-10-05T10:00:00.000000+00:00',
    updated_at: '2026-10-05T10:00:00.000000+00:00',
    duration_minutes: null,
    distance_km: null,
  }
  respond.data = [serverRow]
  await on.workouts.listWorkoutsPage(A)
  await settle()
  setNavigator(false)
  const updated = await on.workouts.updateWorkout(A, 'w-srv', form('55'))
  assert.equal(updated.pendingSync, true)
  const [m] = await on.outbox.listMutations(A)
  assert.equal(m.operation, 'workout.update')
  assert.equal(m.base_updated_at, '2026-10-05T10:00:00.000000+00:00')
  const removed = await on.workouts.deleteWorkout(A, 'w-srv') // update + delete compacta em um delete
  assert.equal(removed.pendingSync, true)
  const all = await on.outbox.listMutations(A)
  assert.equal(all.length, 1)
  assert.equal(all[0].operation, 'workout.delete')
  assert.equal(all[0].base_updated_at, '2026-10-05T10:00:00.000000+00:00')
})

test('criar e apagar OFFLINE o mesmo registro não deixa nada para enviar', async () => {
  setNavigator(false)
  const created = await on.workouts.createWorkout(A, form())
  const removed = await on.workouts.deleteWorkout(A, created.workout.id)
  assert.equal(removed.compacted, 'cancelled')
  assert.deepEqual(await on.outbox.listMutations(A), [])
})

test('com mutação PENDENTE para o registro, a edição NÃO vai direto ao servidor (ele ainda não o conhece)', async () => {
  setNavigator(false)
  const created = await on.workouts.createWorkout(A, form())
  await settle() // o sync de segundo plano da escrita local resolve como \"offline\"
  setNavigator(true)
  respond.data = serverRowFrom
  const callsBefore = globalThis.__calls.length
  const edited = await on.workouts.updateWorkout(A, created.workout.id, form('99'))
  assert.equal(edited.pendingSync, true)
  assert.equal(edited.compacted, 'merged')
  assert.equal(globalThis.__calls.slice(callsBefore).filter((c) => c.kind === 'from').length, 0)
  const [m] = await on.outbox.listMutations(A)
  assert.equal(m.operation, 'workout.create')
  assert.deepEqual(m.payload.set_details, [{ weight: 99, reps: 10 }])
})

test('LEITURA online mostra servidor + pendências (o que foi salvo offline não some quando a rede volta)', async () => {
  setNavigator(false)
  const created = await on.workouts.createWorkout(A, form('77'))
  await settle() // o sync de segundo plano da escrita local resolve como \"offline\"
  setNavigator(true)
  const server1 = {
    user_id: A,
    id: 'w-srv',
    exercise_id: EX,
    type: 'strength',
    set_details: [{ weight: 50, reps: 5 }],
    sets: 1,
    date: '2026-10-04',
    note: '',
    created_at: '2026-10-04T10:00:00.000000+00:00',
    updated_at: '2026-10-04T10:00:00.000000+00:00',
    duration_minutes: null,
    distance_km: null,
  }
  respond.data = [server1]
  const page = await on.workouts.listWorkoutsPage(A)
  assert.deepEqual(
    page.items.map((w) => w.id),
    [created.workout.id, 'w-srv']
  )
  assert.deepEqual(page.items[0].setDetails, [{ weight: 77, reps: 10 }])
  // E o cache não perde a linha local pendente quando o servidor "não a conhece".
  await settle()
  assert.ok(await on.history.readCachedWorkoutRow(A, created.workout.id))
})

test('LEITURA sem rede devolve o estado local, inclusive o que está pendente', async () => {
  respond.data = []
  await on.workouts.listWorkoutsPage(A) // confirma o histórico vazio
  await settle()
  setNavigator(false)
  const created = await on.workouts.createWorkout(A, form('61'))
  respond.network = true
  const page = await on.workouts.listWorkoutsPage(A)
  assert.equal(on.isLocalFallback(page), true)
  assert.deepEqual(
    page.items.map((w) => w.id),
    [created.workout.id]
  )
})

test('PONTA A PONTA: salva offline -> a internet volta -> sincroniza (RPC) -> fila vazia, sem duplicar no servidor', async () => {
  setNavigator(false)
  const created = await on.workouts.createWorkout(A, form('70'))
  await on.workouts.updateWorkout(A, created.workout.id, form('72'))
  assert.equal((await on.outbox.listMutations(A)).length, 1)
  assert.equal(server.rowsOf(A).length, 0)
  await settle()

  setNavigator(true)
  const result = await on.scheduler.requestSync('online', { force: true })
  assert.equal(result.status, 'synced')
  const rpc = globalThis.__calls.filter((c) => c.kind === 'rpc')
  assert.equal(rpc.length >= 1, true)
  assert.equal(rpc[0].params.p_expected_user, A) // fila de A só sob a sessão de A
  assert.equal(rpc[0].params.p_mutations.length, 1)
  assert.ok(!('user_id' in rpc[0].params.p_mutations[0].payload))
  assert.deepEqual(await on.outbox.listMutations(A), [])
  assert.equal(server.rowsOf(A).length, 1)
  assert.deepEqual(server.rows.get(`${A}|${created.workout.id}`).set_details, [
    { weight: 72, reps: 10 },
  ])
  // O repetido não faz nada: sem pendências nem chamada nova.
  const before = globalThis.__calls.length
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'idle')
  assert.equal(globalThis.__calls.length, before)
  assert.equal(on.status.getSyncSnapshot().pending, 0)
})

test('PONTA A PONTA com ACK perdido: o reenvio via scheduler não duplica no servidor', async () => {
  setNavigator(false)
  await on.workouts.createWorkout(A, form('70'))
  await settle()
  setNavigator(true)
  const original = globalThis.__respond
  let first = true
  globalThis.__respond = (call) => {
    const out = original(call)
    if (call.kind === 'rpc' && first) {
      first = false
      return { data: null, error: NETWORK } // o servidor aplicou, mas a resposta se perdeu
    }
    return out
  }
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'retry')
  assert.equal(server.rowsOf(A).length, 1)
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'synced')
  assert.equal(server.rowsOf(A).length, 1)
  assert.deepEqual(await on.outbox.listMutations(A), [])
})

test('syncNow ("Sincronizar agora") recoloca falhas na fila e ignora a espera do backoff', async () => {
  setNavigator(false)
  await on.workouts.createWorkout(A, form())
  await settle()
  setNavigator(true)
  respond.network = true
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'retry')
  assert.ok((await on.outbox.listMutations(A))[0].next_attempt_at)
  respond.network = false
  assert.equal((await on.scheduler.syncNow()).status, 'synced')
  assert.deepEqual(await on.outbox.listMutations(A), [])
})

test('sem sessão (logout) nada é enviado e a fila fica guardada; ao logar de novo sincroniza', async () => {
  setNavigator(false)
  await on.workouts.createWorkout(A, form())
  await settle()
  setNavigator(true)
  globalThis.__session = null
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'no-session')
  await on.scope.purgePrivateData(null) // logout limpa o cache...
  assert.equal((await on.outbox.listMutations(A)).length, 1) // ...mas NÃO a fila
  globalThis.__session = { user: { id: B } }
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'idle') // B não tem fila e não toca a de A
  assert.equal(server.rowsOf(A).length + server.rowsOf(B).length, 0)
  globalThis.__session = { user: { id: A } }
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'synced')
  assert.equal(server.rowsOf(A).length, 1)
})

test('exercícios pessoais: gravações ONLINE atualizam o cache local (sem escrita offline)', async () => {
  const row = {
    user_id: A,
    id: 'ex-new',
    name: 'Remada',
    muscle_group: 'Costas',
    type: 'strength',
    note: '',
    active: true,
    source: 'catalog',
    provider: 'evolutus_dataset',
    provider_exercise_id: 'official-remada',
    catalog_id: null,
    equipment: null,
    order: null,
  }
  respond.data = row
  await on.exercises.createCatalogExercise(A, {
    name: 'Remada',
    muscleGroup: 'Costas',
    provider: 'evolutus_dataset',
    providerExerciseId: 'official-remada',
    note: '',
  })
  await settle()
  respond.data = [row]
  await on.exercises.listExercises(A)
  await settle()
  respond.data = null
  await on.exercises.updateExercise(A, 'ex-new', {
    name: 'Remada Alta',
    muscleGroup: 'Costas',
    note: 'Minha preferência',
    active: true,
  })
  await settle()
  assert.equal((await on.userExercises.readCachedUserExercises(A))[0].name, 'Remada')
  assert.equal((await on.userExercises.readCachedUserExercises(A))[0].note, 'Minha preferência')
  await on.exercises.saveExerciseOrder(A, ['ex-new'])
  await settle()
  assert.equal((await on.userExercises.readCachedUserExercises(A))[0].order, 0)
  await on.exercises.deleteExercise(A, 'ex-new')
  await settle()
  assert.deepEqual(await on.userExercises.readCachedUserExercises(A), [])
  // Offline, criar exercício continua falhando (não existe escrita offline para eles nesta fase).
  setNavigator(false)
  respond.network = true
  await assert.rejects(
    on.exercises.createCatalogExercise(A, {
      name: 'X',
      muscleGroup: 'Peito',
      provider: 'evolutus_dataset',
      providerExerciseId: 'x',
      note: '',
    }),
    (e) => e === NETWORK
  )
  assert.deepEqual(await on.outbox.listMutations(A), [])
})

// ============================================================================ flag DESLIGADA

test('flag DESLIGADA: o INSERT é o de antes (sem id do cliente), o resultado é "synced" e a outbox nunca é usada', async () => {
  assert.equal(off.isOfflineWriteEnabled(), false)
  respond.data = (call) => ({
    ...call.steps.find(([m]) => m === 'insert')[1],
    id: 'server-id',
    created_at: 'c',
    updated_at: 'c',
  })
  const result = await off.workouts.createWorkout(A, form())
  const insert = globalThis.__calls[0].steps.find(([m]) => m === 'insert')[1]
  assert.ok(!('id' in insert))
  assert.equal(insert.user_id, A)
  assert.equal(result.synced, true)
  assert.equal(result.workout.id, 'server-id')
  assert.deepEqual(await off.outbox.listMutations(A), [])
})

test('flag DESLIGADA: rede caindo continua sendo ERRO (nada é salvo localmente), mesmo com o navegador offline', async () => {
  respond.network = true
  await assert.rejects(off.workouts.createWorkout(A, form()), (e) => e === NETWORK)
  await assert.rejects(off.workouts.updateWorkout(A, 'w1', form()), (e) => e === NETWORK)
  await assert.rejects(off.workouts.deleteWorkout(A, 'w1'), (e) => e === NETWORK)
  setNavigator(false)
  await assert.rejects(off.workouts.createWorkout(A, form()), (e) => e === NETWORK) // ainda chama o servidor, como antes
  assert.deepEqual(await off.outbox.listMutations(A), [])
  assert.equal(await off.history.readCachedWorkouts(A), undefined)
})

test('flag DESLIGADA: update/delete são os de antes e leituras seguem iguais', async () => {
  respond.data = {
    user_id: A,
    id: 'w1',
    exercise_id: EX,
    type: 'strength',
    set_details: [{ weight: 80, reps: 10 }],
    sets: 1,
    date: today,
    note: '',
    created_at: 'c',
    updated_at: 'c',
    duration_minutes: null,
    distance_km: null,
  }
  const updated = await off.workouts.updateWorkout(A, 'w1', form())
  assert.equal(updated.synced, true)
  const steps = globalThis.__calls[0].steps.map(([m]) => m)
  assert.deepEqual(steps.slice(0, 2), ['update', 'eq'])
  assert.ok(!steps.includes('abortSignal')) // sem o timeout novo: caminho antigo intacto
  const deleted = await off.workouts.deleteWorkout(A, 'w1')
  assert.equal(deleted.synced, true)
  respond.data = [respond.data]
  const page = await off.workouts.listWorkoutsPage(A)
  assert.deepEqual(
    page.items.map((w) => w.id),
    ['w1']
  )
  assert.equal(off.isLocalFallback(page), false)
})

// ============================================================ CRÍTICO: INSERT online confirmado + timeout

// O Postgres aplica o INSERT direto (sem recibo) e o cliente nunca recebe a resposta.
function postgresAppliesInsertThenClientLosesResponse({ viaTimeout }) {
  const state = { id: null, row: null }
  // O sync de segundo plano da escrita local é automático; mantém o RPC fora do ar para que a janela
  // "gravado no Postgres, ainda na fila" possa ser observada. Quem libera é o teste (respond.rpcDown = false).
  respond.rpcDown = true
  respond.fn = (call) => {
    const insert = call.steps.find(([m]) => m === 'insert')?.[1]
    if (!insert) return undefined
    state.id = insert.id
    const at = server.stamp()
    state.row = { ...insert, created_at: at, updated_at: at }
    server.seed(state.row) // o Postgres CONFIRMOU a linha...
    if (!viaTimeout) return { data: null, error: NETWORK }
    const signal = call.steps.find(([m]) => m === 'abortSignal')[1]
    return new Promise((resolve) =>
      signal.addEventListener('abort', () =>
        resolve({
          data: null,
          error: {
            message: 'FetchError: The user aborted a request.',
            details: '',
            hint: 'Request was aborted (timeout or manual cancellation)',
            code: '',
          },
        })
      )
    ) // ...e o cliente desistiu por timeout antes de receber a resposta.
  }
  return state
}

async function withShortTimeout(run) {
  const original = AbortSignal.timeout
  AbortSignal.timeout = () => original.call(AbortSignal, 25)
  try {
    return await run()
  } finally {
    AbortSignal.timeout = original
  }
}

for (const viaTimeout of [false, true]) {
  const label = viaTimeout ? 'timeout (AbortSignal)' : 'queda de rede'
  test(`CRÍTICO (${label}): INSERT confirmado, o cliente enfileira o MESMO id e a RPC reconhece a linha existente — sem duplicar`, async () => {
    const state = postgresAppliesInsertThenClientLosesResponse({ viaTimeout })
    const result = await withShortTimeout(() => on.workouts.createWorkout(A, form('70')))
    // O serviço leu a falha como "não sei se aplicou": salvou local + fila, com o id que ENVIOU.
    assert.equal(result.synced, false)
    assert.equal(result.pendingSync, true)
    const [queued] = await on.outbox.listMutations(A)
    assert.equal(queued.operation, 'workout.create')
    assert.equal(queued.entity_id, state.id)
    assert.equal(server.rowsOf(A).length, 1) // já existe no servidor...
    assert.equal(server.receipts.size, 0) // ...e NÃO existe recibo

    await settle() // a 1ª tentativa de sync em segundo plano falha (RPC fora do ar) e a mutação volta à fila
    respond.fn = null
    respond.rpcDown = false
    const sync = await on.scheduler.requestSync('online', { force: true })
    assert.equal(sync.status, 'synced')
    assert.equal(server.rowsOf(A).length, 1) // não duplicou
    assert.equal(server.receipts.size, 1) // recibo criado agora
    const row = server.rows.get(`${A}|${state.id}`)
    assert.equal(row.created_at, state.row.created_at) // created_at intocado
    assert.equal(row.updated_at, state.row.updated_at) // nada reescrito
    assert.deepEqual(await on.outbox.listMutations(A), [])
    const local = await on.history.readCachedWorkoutRow(A, state.id)
    assert.equal(local.created_at, state.row.created_at) // o aparelho adotou a linha oficial
    assert.equal(local.updated_at, state.row.updated_at)
    // Reenvios posteriores não fazem nada.
    assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'idle')
    assert.equal(server.rowsOf(A).length, 1)
  })
}

test('CRÍTICO: INSERT confirmado + timeout e o usuário EDITA em seguida: a edição chega ao servidor e created_at não muda', async () => {
  const state = postgresAppliesInsertThenClientLosesResponse({ viaTimeout: true })
  await withShortTimeout(() => on.workouts.createWorkout(A, form('70')))
  await settle() // 1ª tentativa de sync em segundo plano falha (RPC fora do ar)
  respond.fn = null
  const edited = await on.workouts.updateWorkout(A, state.id, form('95')) // há pendência: compacta no create
  assert.equal(edited.compacted, 'merged')
  await settle()
  respond.rpcDown = false
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'synced')
  const row = server.rows.get(`${A}|${state.id}`)
  assert.deepEqual(row.set_details, [{ weight: 95, reps: 10 }])
  assert.equal(row.created_at, state.row.created_at)
  assert.equal(server.rowsOf(A).length, 1)
  assert.deepEqual(await on.outbox.listMutations(A), [])
})

test('CRÍTICO: INSERT confirmado + timeout, depois OUTRO aparelho altera: conflito explícito, servidor intacto, dado local preservado e as duas saídas funcionam', async () => {
  const state = postgresAppliesInsertThenClientLosesResponse({ viaTimeout: false })
  await on.workouts.createWorkout(A, form('70'))
  await settle()
  respond.fn = null
  // Outro aparelho altera a linha no servidor antes de a fila ser enviada.
  const other = server.rows.get(`${A}|${state.id}`)
  other.set_details = [{ weight: 100, reps: 3 }]
  other.updated_at = server.stamp()
  respond.rpcDown = false
  const sync = await on.scheduler.requestSync('online', { force: true })
  assert.equal(sync.failed, 1)
  assert.deepEqual(server.rows.get(`${A}|${state.id}`).set_details, [{ weight: 100, reps: 3 }]) // nunca sobrescrito
  assert.equal(server.receipts.size, 0)
  const [m] = await on.outbox.listMutations(A)
  assert.equal(m.status, 'failed')
  assert.equal(m.last_error.code, 'CONFLICT')
  assert.deepEqual((await on.history.readCachedWorkoutRow(A, state.id)).set_details, [
    { weight: 70, reps: 10 },
  ]) // dado local preservado
  on.status.setSyncUser(A) // o store ignora refresh de quem não é o usuário atual (isolamento entre contas)
  await on.status.refreshSyncStatus(A)
  assert.equal(on.status.getSyncSnapshot().failed, 1)

  // Saída 1: "Manter o meu".
  await on.actions.resolveFailedMutation(A, m, 'keep')
  await settle()
  assert.deepEqual(server.rows.get(`${A}|${state.id}`).set_details, [{ weight: 70, reps: 10 }])
  assert.deepEqual(await on.outbox.listMutations(A), [])
  assert.equal(server.rows.get(`${A}|${state.id}`).created_at, state.row.created_at)
})

test('CRÍTICO (conflito): "Usar o do servidor" restaura a versão do servidor localmente e esvazia a fila', async () => {
  const state = postgresAppliesInsertThenClientLosesResponse({ viaTimeout: false })
  await on.workouts.createWorkout(A, form('70'))
  await settle()
  respond.fn = null
  const other = server.rows.get(`${A}|${state.id}`)
  other.set_details = [{ weight: 100, reps: 3 }]
  other.updated_at = server.stamp()
  respond.rpcDown = false
  await on.scheduler.requestSync('online', { force: true })
  const [m] = await on.outbox.listMutations(A)
  await on.actions.resolveFailedMutation(A, m, 'discard')
  assert.deepEqual(await on.outbox.listMutations(A), [])
  assert.deepEqual((await on.history.readCachedWorkoutRow(A, state.id)).set_details, [
    { weight: 100, reps: 3 },
  ])
  assert.deepEqual(server.rows.get(`${A}|${state.id}`).set_details, [{ weight: 100, reps: 3 }])
})

// ====================================================== FINALIZAR TREINO: só as mutações DESTE treino

const yesterday = '2026-10-04'

// Ontem: um registro editado offline que ENTROU em conflito (alterado em outro aparelho).
async function seedYesterdayConflict() {
  const old = {
    user_id: A,
    id: 'w-ontem',
    exercise_id: EX,
    type: 'strength',
    set_details: [{ weight: 50, reps: 5 }],
    sets: 1,
    date: yesterday,
    note: '',
    duration_minutes: null,
    distance_km: null,
    created_at: '2026-10-04T10:00:00.000000+00:00',
    updated_at: '2026-10-04T10:00:00.000000+00:00',
  }
  respond.data = [old]
  await on.workouts.listWorkoutsPage(A)
  await settle()
  server.seed({ ...old, set_details: [{ weight: 99, reps: 1 }], updated_at: server.stamp() }) // outro aparelho mexeu
  setNavigator(false)
  await on.workouts.updateWorkout(A, 'w-ontem', { ...form('55'), date: yesterday })
  await settle()
  setNavigator(true)
  await on.scheduler.requestSync('online', { force: true }) // vira failed/CONFLICT
  assert.equal((await on.outbox.listMutations(A))[0].status, 'failed')
}

async function fourPendingToday() {
  setNavigator(false)
  for (const w of ['40', '45', '50', '55']) await on.workouts.createWorkout(A, form(w))
  await settle()
  setNavigator(true)
}

test('FINALIZAR: conflito antigo de ontem + 4 pendências de hoje -> sincroniza as 4, conclui e a antiga segue visível', async () => {
  await seedYesterdayConflict()
  await fourPendingToday()
  assert.equal((await on.outbox.listMutations(A)).length, 5)
  const flush = await on.scheduler.flushPending(A, { date: today })
  assert.deepEqual(flush, { pending: 0, failed: 0, other: 1 }) // nada de hoje impede concluir
  assert.equal(server.rowsOf(A).filter((r) => r.date === today).length, 4) // as 4 chegaram e foram confirmadas
  const left = await on.outbox.listMutations(A)
  assert.equal(left.length, 1)
  assert.equal(left[0].entity_id, 'w-ontem')
  assert.equal(left[0].status, 'failed') // a pendência antiga continua na fila
  on.status.setSyncUser(A)
  await on.status.refreshSyncStatus(A)
  assert.equal(on.status.getSyncSnapshot().failed, 1) // e aparecendo no SyncStatus
  assert.deepEqual(server.rows.get(`${A}|w-ontem`).set_details, [{ weight: 99, reps: 1 }]) // sem sobrescrever o remoto
})

test('FINALIZAR: conflito/falha de HOJE bloqueia (atenção), e nada é concluído com registro não confirmado', async () => {
  const todayRow = {
    user_id: A,
    id: 'w-hoje',
    exercise_id: EX,
    type: 'strength',
    set_details: [{ weight: 50, reps: 5 }],
    sets: 1,
    date: today,
    note: '',
    duration_minutes: null,
    distance_km: null,
    created_at: '2026-10-05T09:00:00.000000+00:00',
    updated_at: '2026-10-05T09:00:00.000000+00:00',
  }
  respond.data = [todayRow]
  await on.workouts.listWorkoutsPage(A)
  await settle()
  server.seed({ ...todayRow, set_details: [{ weight: 99, reps: 1 }], updated_at: server.stamp() })
  setNavigator(false)
  await on.workouts.updateWorkout(A, 'w-hoje', form('60'))
  await settle()
  setNavigator(true)
  const flush = await on.scheduler.flushPending(A, { date: today })
  assert.equal(flush.failed, 1)
  assert.equal(flush.pending, 0)
})

test('FINALIZAR: se o sync necessário falha (rede), as de hoje seguem pendentes e a conclusão é bloqueada; ontem não conta', async () => {
  await seedYesterdayConflict()
  await fourPendingToday()
  respond.rpcDown = true
  const flush = await on.scheduler.flushPending(A, { date: today })
  assert.equal(flush.pending, 4)
  assert.equal(flush.failed, 0)
  assert.equal(flush.other, 1)
  assert.equal(server.rowsOf(A).filter((r) => r.date === today).length, 0)
  // A rede volta: a mesma verificação libera.
  respond.rpcDown = false
  assert.deepEqual(await on.scheduler.flushPending(A, { date: today }), {
    pending: 0,
    failed: 0,
    other: 1,
  })
})

test('FINALIZAR: sem nenhuma pendência o flush não chama o servidor', async () => {
  const before = globalThis.__calls.length
  assert.deepEqual(await on.scheduler.flushPending(A, { date: today }), {
    pending: 0,
    failed: 0,
    other: 0,
  })
  assert.equal(globalThis.__calls.slice(before).filter((c) => c.kind === 'rpc').length, 0)
})

test('FINALIZAR: o flush de A nunca envia nem conta a fila de B', async () => {
  setNavigator(false)
  await on.workouts.createWorkout(A, form('40'))
  await settle()
  setNavigator(true)
  globalThis.__session = { user: { id: B } }
  assert.deepEqual(await on.scheduler.flushPending(B, { date: today }), {
    pending: 0,
    failed: 0,
    other: 0,
  })
  assert.equal(server.rowsOf(A).length, 0)
  assert.equal((await on.outbox.listMutations(A)).length, 1)
})

// ================================================================== LOGOUT com outbox pendente: A -> B -> A

test('LOGOUT: A cria pendências, sai; B entra e NÃO vê nem sincroniza as de A; B sai; A volta, as pendências reaparecem e sincronizam', async () => {
  const login = async (userId) => {
    globalThis.__session = { user: { id: userId } }
    on.status.setSyncUser(userId) // o que useSyncScheduler faz ao montar o Layout com o usuário
    await on.status.refreshSyncStatus(userId)
  }
  const logout = async () => {
    globalThis.__session = null
    await on.scope.purgePrivateData(null) // AuthContext.loadSession(null)
  }

  // --- A trabalha offline: 2 alterações guardadas, com o aviso certo.
  await login(A)
  setNavigator(false)
  await on.workouts.createWorkout(A, form('40'))
  await on.workouts.createWorkout(A, form('45'))
  await settle()
  await on.status.refreshSyncStatus(A)
  assert.equal(on.notice.getPendingCount(), 2)
  assert.equal(
    on.notice.describeLogoutNotice(on.notice.getPendingCount()),
    '2 alterações ainda estão salvas neste aparelho. Elas serão sincronizadas quando você entrar novamente nesta conta.'
  )
  await logout() // o logout NÃO é impedido e NÃO apaga a fila
  assert.equal((await on.outbox.listMutations(A)).length, 2)

  // --- B entra (com internet): não vê nada de A, não sincroniza nada de A, não herda o aviso.
  setNavigator(true)
  await login(B)
  assert.equal(on.notice.getPendingCount(), 0)
  assert.equal(on.notice.describeLogoutNotice(on.notice.getPendingCount()), null)
  assert.deepEqual(await on.outbox.listMutations(B), [])
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'idle')
  assert.equal(globalThis.__calls.filter((c) => c.kind === 'rpc').length, 0)
  assert.equal(server.rowsOf(A).length + server.rowsOf(B).length, 0)
  assert.equal(await on.history.readCachedWorkouts(B), undefined) // a sessão de B não lê histórico algum (nem o de A)
  assert.equal(
    await on.history.readCachedWorkoutRow(B, (await on.outbox.listMutations(A))[0].entity_id),
    undefined
  )
  // B também guarda uma pendência offline e sai.
  setNavigator(false)
  await on.workouts.createWorkout(B, form('30'))
  await settle()
  await on.status.refreshSyncStatus(B)
  assert.equal(on.notice.getPendingCount(), 1)
  await logout()
  assert.equal((await on.outbox.listMutations(B)).length, 1)

  // --- A volta: as 2 pendências reaparecem (e só as 2 dele) e o sync funciona.
  setNavigator(true)
  await login(A)
  assert.equal(on.notice.getPendingCount(), 2)
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'synced')
  assert.equal(server.rowsOf(A).length, 2)
  assert.equal(server.rowsOf(B).length, 0) // a fila de B nunca foi enviada sob a sessão de A
  const sent = globalThis.__calls
    .filter((c) => c.kind === 'rpc')
    .flatMap((c) => c.params.p_mutations)
  assert.equal(sent.length, 2)
  assert.equal((await on.outbox.listMutations(A)).length, 0)
  assert.equal((await on.outbox.listMutations(B)).length, 1) // intacta

  // --- B volta depois e sincroniza a dele.
  await logout()
  await login(B)
  assert.equal(on.notice.getPendingCount(), 1)
  assert.equal((await on.scheduler.requestSync('online', { force: true })).status, 'synced')
  assert.equal(server.rowsOf(B).length, 1)
  assert.equal(server.rowsOf(A).length, 2)
})

test('o aviso de logout só mostra a quantidade (nunca dado do treino) e some com a fila vazia', async () => {
  assert.equal(on.notice.describeLogoutNotice(0), null)
  assert.equal(on.notice.describeLogoutNotice(undefined), null)
  assert.match(on.notice.describeLogoutNotice(1), /^1 alteração ainda está salva neste aparelho\./)
  on.notice.publishPendingCount(3)
  assert.equal(on.notice.getPendingCount(), 3)
  on.status.resetSyncStatusForTests()
  assert.equal(on.notice.getPendingCount(), 0)
})

// ============================================================================ id do cliente (série a série)

const UNIQUE = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "workouts_pkey"',
}
const CLIENT_ID = 'c3000000-0000-4000-8000-0000000000aa'

for (const [label, service, flag] of [
  ['flag DESLIGADA', () => off, 'off'],
  ['flag ligada', () => on, 'on'],
]) {
  test(`${label}: createWorkout com id do cliente envia esse id e repetir a criação vira UPDATE do mesmo registro`, async () => {
    const api = service()
    respond.fn = (call) => {
      const steps = call.steps.map(([m]) => m)
      if (steps.includes('insert'))
        return { data: null, error: globalThis.__alreadyThere ? UNIQUE : null }
      return undefined
    }
    respond.data = (call) => {
      const insert = call.steps.find(([m]) => m === 'insert')?.[1]
      return {
        ...(insert || {}),
        id: CLIENT_ID,
        user_id: A,
        exercise_id: EX,
        type: 'strength',
        set_details: [{ weight: 80, reps: 10 }],
        sets: 1,
        date: today,
        note: '',
        duration_minutes: null,
        distance_km: null,
        created_at: 'c',
        updated_at: 'c',
      }
    }

    globalThis.__alreadyThere = false
    const first = await api.workouts.createWorkout(A, form(), { id: CLIENT_ID })
    assert.equal(first.synced, true, flag)
    const insert = globalThis.__calls[0].steps.find(([m]) => m === 'insert')[1]
    assert.equal(insert.id, CLIENT_ID)

    // A resposta da primeira tentativa se perdeu: o servidor responde "já existe" ao reenvio.
    globalThis.__calls = []
    globalThis.__alreadyThere = true
    const retry = await api.workouts.createWorkout(A, form('85'), { id: CLIENT_ID })
    delete globalThis.__alreadyThere
    assert.equal(retry.synced, true)
    const kinds = globalThis.__calls.map((c) => c.steps.map(([m]) => m)[0])
    assert.deepEqual(kinds, ['insert', 'update'])
    const update = globalThis.__calls[1].steps
    assert.ok(
      update.some(([m, column, value]) => m === 'eq' && column === 'id' && value === CLIENT_ID)
    )
    assert.deepEqual(await api.outbox.listMutations(A), [])
  })
}

test('createWorkout sem id do cliente mantém o comportamento anterior (erro de unicidade continua sendo erro)', async () => {
  respond.error = UNIQUE
  await assert.rejects(off.workouts.createWorkout(A, form()), (e) => e === UNIQUE)
})

test('personal exercise updates send only note/active and never identity; no custom creation API remains', async () => {
  assert.equal(on.exercises.createExercise, undefined)
  respond.data = null
  await on.exercises.updateExercise(A, EX, {
    name: 'forged',
    muscleGroup: 'forged',
    type: 'cardio',
    source: 'custom',
    provider: 'forged',
    catalogId: 'forged',
    note: '  minha nota  ',
    active: false,
  })
  const call = globalThis.__calls.find(
    (call) => call.table === 'exercises' && call.steps.some(([method]) => method === 'update')
  )
  assert.deepEqual(call.steps.find(([method]) => method === 'update')[1], {
    note: 'minha nota',
    active: false,
  })
})

test('concurrent official duplicate returns the existing row without creating a second link', async () => {
  let insert = true
  const row = {
    id: EX,
    user_id: A,
    name: 'Servidor',
    muscle_group: 'Peito',
    source: 'catalog',
    provider: 'evolutus_dataset',
    provider_exercise_id: 'pub',
    active: true,
  }
  globalThis.__respond = (call) => {
    if (call.steps.some(([method]) => method === 'insert') && insert) {
      insert = false
      return { data: null, error: { code: '23505' } }
    }
    return { data: row, error: null }
  }
  const result = await on.exercises.createCatalogExercise(A, {
    name: 'Cliente',
    muscleGroup: 'Costas',
    provider: 'evolutus_dataset',
    providerExerciseId: 'pub',
  })
  assert.equal(result.added, false)
  assert.equal(result.exercise.name, 'Servidor')
  assert.equal(result.exercise.id, EX)
})
