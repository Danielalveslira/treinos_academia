import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDatabase, rawAll, rawOpen, workoutRow } from './testSupport.js'
import {
  OPERATIONS,
  STATUS,
  enqueueWorkoutMutation,
  listMutations,
  claimNextBatch,
  getOutboxSummary,
  retryFailed,
  isRelevantToDate,
  keepLocalAfterConflict,
} from './outbox.js'
import { recordWorkoutsPage } from './historyCache.js'
import { classifySyncError, syncOutbox, toWire } from './syncEngine.js'
import { withSyncLock } from './syncLock.js'
import { NETWORK_ERROR, makeDeps, makeServer } from './syncTestKit.js'
import { isOfflineWriteEnabled } from './database.js'
import { setOfflineRolloutUser, setRemoteRolloutSnapshot } from './rollout.js'

const A = 'user-a'
const B = 'user-b'
const E1 = 'e0000000-0000-0000-0000-000000000001'
const E2 = 'e0000000-0000-0000-0000-000000000002'
const NOW = Date.UTC(2026, 9, 5, 12)

const strength = (weight = 80, overrides = {}) => ({
  exercise_id: 'ex-1',
  date: '2026-10-05',
  type: 'strength',
  set_details: [{ weight, reps: 10 }],
  sets: 1,
  duration_minutes: null,
  distance_km: null,
  note: '',
  ...overrides,
})
const enqueue = (userId, operation, entityId, payload, extra = {}) =>
  enqueueWorkoutMutation(userId, { operation, entityId, payload, now: NOW, ...extra })
const pendingOf = (userId = A) => listMutations(userId)
const sync = (deps, options = {}) => syncOutbox({ deps, ...options })

let restoreNavigator
beforeEach(async () => {
  await freshDatabase()
  restoreNavigator = null
})
afterEach(() => restoreNavigator?.())

function setBrowserOnline(onLine) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true })
  restoreNavigator = () =>
    original
      ? Object.defineProperty(globalThis, 'navigator', original)
      : delete globalThis.navigator
}

// ------------------------------------------------------------------------------------ caminho feliz

test('sincronização normal: envia, o servidor confirma (ACK), a outbox esvazia e o local ganha a linha oficial', async () => {
  const server = makeServer()
  const deps = makeDeps({ server })
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  await enqueue(A, OPERATIONS.update, E1, strength(85)) // compacta em um único create
  const result = await sync(deps)
  assert.equal(result.status, 'synced')
  assert.equal(result.applied, 1)
  assert.deepEqual(await pendingOf(), [])
  assert.equal(server.rowsOf(A).length, 1)
  assert.deepEqual(server.rows.get(`${A}|${E1}`).set_details, [{ weight: 85, reps: 10 }])
  const [local] = await rawAll('workouts')
  assert.equal(local.created_at, server.rows.get(`${A}|${E1}`).created_at) // carimbo do servidor
  assert.equal(server.batches.length, 1)
  assert.equal(server.batches[0].length, 1)
})

test('kill switch da escrita impede novas escritas, mas não bloqueia a outbox já existente', async () => {
  const server = makeServer()
  await enqueue(A, OPERATIONS.create, E1, strength())
  setOfflineRolloutUser(A)
  setRemoteRolloutSnapshot(A, {
    offline_write: { enabled: false, rollout_percentage: 100 },
    offline_cold_start: { enabled: false, rollout_percentage: 0 },
  })
  assert.equal(isOfflineWriteEnabled({ PROD: true, VITE_OFFLINE_WRITE_ENABLED: 'true' }), false)
  const result = await sync(makeDeps({ server }))
  assert.equal(result.status, 'synced')
  assert.equal(result.applied, 1)
  assert.deepEqual(await pendingOf(), [])
  setOfflineRolloutUser(null)
})

test('o fio carrega só os campos da lista fechada (sem user_id/created_at) e o delete não leva payload', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  await recordWorkoutsPage(A, [workoutRow({ id: E2, updated_at: 'v1' })], { now: NOW })
  await enqueue(A, OPERATIONS.delete, E2, null, { baseUpdatedAt: 'v1' })
  const [create, del] = (await pendingOf()).map(toWire)
  assert.deepEqual(Object.keys(create).sort(), [
    'base_updated_at',
    'entity_id',
    'mutation_id',
    'operation',
    'payload',
  ])
  assert.ok(
    !('user_id' in create) && !('user_id' in create.payload) && !('created_at' in create.payload)
  )
  assert.deepEqual(Object.keys(del).sort(), [
    'base_updated_at',
    'entity_id',
    'mutation_id',
    'operation',
  ])
})

test('mais de 25 mutações saem em vários lotes, em ordem de seq', async () => {
  const server = makeServer()
  const deps = makeDeps({ server })
  const ids = Array.from(
    { length: 30 },
    (_, i) => `e${String(i).padStart(7, '0')}-0000-0000-0000-000000000000`
  )
  for (const id of ids) await enqueue(A, OPERATIONS.create, id, strength())
  const result = await sync(deps)
  assert.equal(result.applied, 30)
  assert.deepEqual(
    server.batches.map((b) => b.length),
    [25, 5]
  )
  assert.deepEqual(
    server.batches.flat().map((w) => w.entity_id),
    ids
  )
  assert.deepEqual(await pendingOf(), [])
})

test('sem pendências o engine não chama o servidor (e sem sessão não faz nada)', async () => {
  const server = makeServer()
  const deps = makeDeps({ server })
  assert.equal((await sync(deps)).status, 'idle')
  assert.equal(deps.calls, 0)
  await enqueue(A, OPERATIONS.create, E1, strength())
  const none = makeDeps({ server, getUser: () => null })
  assert.equal((await sync(none)).status, 'no-session')
  assert.equal(none.calls, 0)
  assert.equal((await pendingOf()).length, 1)
})

// ----------------------------------------------------------- CRÍTICO: ACK perdido / rede caindo

test('CRÍTICO: o servidor aplicou, a conexão caiu antes do ACK -> o retry NÃO duplica', async () => {
  const server = makeServer()
  const behavior = {
    after: (call) => {
      if (call <= 2) throw NETWORK_ERROR()
    },
  } // 2 respostas perdidas
  const deps = makeDeps({ server, behavior })
  await enqueue(A, OPERATIONS.create, E1, strength(80))

  const first = await sync(deps)
  assert.equal(first.status, 'retry')
  assert.equal(server.rowsOf(A).length, 1) // o servidor JÁ aplicou
  assert.equal((await pendingOf()).length, 1) // o cliente não sabe: continua pendente
  assert.equal((await pendingOf())[0].attempts, 1)

  const second = await sync(deps, { force: true }) // retry; a resposta se perde de novo
  assert.equal(second.status, 'retry')
  assert.equal(server.rowsOf(A).length, 1)
  assert.equal(server.receipts.size, 1)

  const third = await sync(deps, { force: true }) // desta vez o ACK chega: já-aplicado
  assert.equal(third.status, 'synced')
  assert.equal(third.applied, 1)
  assert.deepEqual(await pendingOf(), [])
  assert.equal(server.rowsOf(A).length, 1) // UMA linha, depois de 3 envios
  assert.equal(server.receipts.size, 1)
  assert.equal(deps.calls, 3)
  const [local] = await rawAll('workouts')
  assert.equal(local.updated_at, server.rows.get(`${A}|${E1}`).updated_at)
})

test('CRÍTICO (update): ACK perdido de um update não reaplica nem gera conflito consigo mesmo', async () => {
  const server = makeServer()
  server.seed(workoutRow({ id: E1, created_at: 'c0', updated_at: 'v1' }))
  await recordWorkoutsPage(A, [workoutRow({ id: E1, created_at: 'c0', updated_at: 'v1' })], {
    now: NOW,
  })
  await enqueue(A, OPERATIONS.update, E1, strength(90), { baseUpdatedAt: 'v1' })
  const deps = makeDeps({
    server,
    behavior: {
      after: (call) => {
        if (call === 1) throw NETWORK_ERROR()
      },
    },
  })
  assert.equal((await sync(deps)).status, 'retry')
  const afterFirst = server.rows.get(`${A}|${E1}`).updated_at
  assert.notEqual(afterFirst, 'v1')
  const retried = await sync(deps, { force: true })
  assert.equal(retried.status, 'synced')
  assert.equal(server.rows.get(`${A}|${E1}`).updated_at, afterFirst) // não reaplicou
  assert.deepEqual(await pendingOf(), [])
})

test('CRÍTICO (delete): ACK perdido de um delete é idempotente', async () => {
  const server = makeServer()
  server.seed(workoutRow({ id: E1, created_at: 'c0', updated_at: 'v1' }))
  await recordWorkoutsPage(A, [workoutRow({ id: E1, created_at: 'c0', updated_at: 'v1' })], {
    now: NOW,
  })
  await enqueue(A, OPERATIONS.delete, E1, null, { baseUpdatedAt: 'v1' })
  const deps = makeDeps({
    server,
    behavior: {
      after: (call) => {
        if (call === 1) throw NETWORK_ERROR()
      },
    },
  })
  assert.equal((await sync(deps)).status, 'retry')
  assert.equal(server.rowsOf(A).length, 0)
  assert.equal((await sync(deps, { force: true })).status, 'synced')
  assert.deepEqual(await pendingOf(), [])
})

// ---- INSERT online confirmado + timeout: a linha existe no servidor SEM recibo --------------------------

const onlineInsert = (overrides = {}) =>
  workoutRow({
    id: E1,
    created_at: 'c0',
    updated_at: 'c0',
    set_details: [{ weight: 50, reps: 10 }],
    note: '',
    ...overrides,
  })

test('INSERT online confirmado + timeout, conteúdo IGUAL: já-aplicado; sem duplicar, sem reescrever e sem conflito falso', async () => {
  const server = makeServer()
  server.seed(onlineInsert())
  await enqueue(A, OPERATIONS.create, E1, strength(50))
  const result = await sync(makeDeps({ server }))
  assert.equal(result.status, 'synced')
  assert.equal(server.rowsOf(A).length, 1)
  const row = server.rows.get(`${A}|${E1}`)
  assert.equal(row.created_at, 'c0')
  assert.equal(row.updated_at, 'c0') // nada foi reescrito
  assert.equal(server.receipts.size, 1) // recibo criado
  assert.deepEqual(await pendingOf(), [])
  const [local] = await rawAll('workouts')
  assert.equal(local.updated_at, 'c0')
})

test('INSERT confirmado + timeout, e o usuário EDITOU depois (compactado no create) sem mais ninguém mexer: a edição NÃO se perde', async () => {
  const server = makeServer()
  server.seed(onlineInsert())
  await enqueue(A, OPERATIONS.create, E1, strength(50))
  await enqueue(A, OPERATIONS.update, E1, strength(55)) // vira um create com o estado final (55)
  const result = await sync(makeDeps({ server }))
  assert.equal(result.status, 'synced')
  const row = server.rows.get(`${A}|${E1}`)
  assert.deepEqual(row.set_details, [{ weight: 55, reps: 10 }]) // a edição chegou
  assert.equal(row.created_at, 'c0') // created_at nunca muda
  assert.equal(server.rowsOf(A).length, 1)
  assert.deepEqual(await pendingOf(), [])
  assert.deepEqual((await rawAll('workouts'))[0].set_details, [{ weight: 55, reps: 10 }])
})

test('INSERT confirmado + timeout, alterado DEPOIS em outro aparelho: o create antigo NÃO vira já-aplicado às cegas — conflito, nada sobrescrito', async () => {
  const server = makeServer()
  server.seed(onlineInsert({ updated_at: 'c1', set_details: [{ weight: 70, reps: 10 }] })) // outro aparelho mexeu
  await enqueue(A, OPERATIONS.create, E1, strength(50))
  const result = await sync(makeDeps({ server }))
  assert.equal(result.failed, 1)
  assert.deepEqual(server.rows.get(`${A}|${E1}`).set_details, [{ weight: 70, reps: 10 }]) // servidor intacto
  assert.equal(server.receipts.size, 0)
  const [m] = await pendingOf()
  assert.equal(m.status, STATUS.failed)
  assert.equal(m.last_error.code, 'CONFLICT')
  assert.equal(m.last_error.server_row.updated_at, 'c1')
  assert.deepEqual((await rawAll('workouts'))[0].set_details, [{ weight: 50, reps: 10 }]) // o dado local fica
  // "Manter o meu": a base passa a ser a versão atual do servidor e o create aplica como atualização.
  await keepLocalAfterConflict(A, m.mutation_id, { now: NOW })
  assert.equal((await sync(makeDeps({ server }), { force: true })).status, 'synced')
  assert.deepEqual(server.rows.get(`${A}|${E1}`).set_details, [{ weight: 50, reps: 10 }])
  assert.equal(server.rows.get(`${A}|${E1}`).created_at, 'c0')
})

test('INSERT confirmado, alterado em outro aparelho, e o resultado já é o que o create pede: equivalente (sem conflito falso)', async () => {
  const server = makeServer()
  server.seed(onlineInsert({ updated_at: 'c1', set_details: [{ weight: 60, reps: 10 }] }))
  await enqueue(A, OPERATIONS.create, E1, strength(60))
  assert.equal((await sync(makeDeps({ server }))).status, 'synced')
  assert.equal(server.rows.get(`${A}|${E1}`).updated_at, 'c1')
  assert.deepEqual(await pendingOf(), [])
})

test('INSERT confirmado, alterado em outro aparelho: "Usar o do servidor" descarta a mudança local e restaura a versão do servidor', async () => {
  const { discardMutation } = await import('./outbox.js')
  const server = makeServer()
  server.seed(onlineInsert({ updated_at: 'c1', set_details: [{ weight: 70, reps: 10 }] }))
  await enqueue(A, OPERATIONS.create, E1, strength(50))
  await sync(makeDeps({ server }))
  const [m] = await pendingOf()
  await discardMutation(A, m.mutation_id)
  assert.deepEqual(await pendingOf(), [])
  assert.deepEqual((await rawAll('workouts'))[0].set_details, [{ weight: 70, reps: 10 }])
})

test('a rede cai ANTES de a requisição chegar: nada aplicado, mutação volta à fila com backoff e depois sincroniza', async () => {
  const server = makeServer()
  const behavior = {
    before: (call) => {
      if (call === 1) throw NETWORK_ERROR()
    },
  }
  const deps = makeDeps({ server, behavior })
  await enqueue(A, OPERATIONS.create, E1, strength())
  const first = await sync(deps)
  assert.equal(first.status, 'retry')
  assert.equal(server.rowsOf(A).length, 0)
  const [m] = await pendingOf()
  assert.equal(m.status, STATUS.pending)
  assert.equal(m.attempts, 1)
  assert.ok(m.next_attempt_at > NOW)
  assert.equal(first.nextAttemptAt, m.next_attempt_at)
  // Sem force, respeita a espera: nem chama o servidor.
  const callsBefore = deps.calls
  await sync(deps)
  assert.equal(deps.calls, callsBefore)
  // Evento `online` (force) ignora a espera.
  assert.equal((await sync(deps, { force: true })).status, 'synced')
  assert.equal(server.rowsOf(A).length, 1)
})

test('timeout do envio (abort) é falha transitória: volta à fila e reenvia depois', async () => {
  const server = makeServer()
  const behavior = {
    before: (call, signal) =>
      call === 1
        ? new Promise((_, reject) =>
            signal.addEventListener('abort', () =>
              reject({ name: 'AbortError', message: 'aborted', hint: 'Request was aborted' })
            )
          )
        : undefined,
  }
  const deps = makeDeps({ server, behavior, extra: { rpcTimeoutMs: 20 } })
  await enqueue(A, OPERATIONS.create, E1, strength())
  assert.equal((await sync(deps)).status, 'retry')
  assert.equal((await pendingOf())[0].attempts, 1)
  assert.equal((await sync(deps, { force: true })).status, 'synced')
  assert.equal(server.rowsOf(A).length, 1)
})

test('5xx / gateway / RPC ainda não publicada são transitórios e contam tentativa', async () => {
  for (const error of [
    { message: 'Bad Gateway', code: '' },
    { message: 'Could not find the function public.sync_workout_mutations', code: 'PGRST202' },
    { message: 'upstream connect error', code: '' },
  ]) {
    await freshDatabase()
    const deps = makeDeps({
      server: makeServer(),
      behavior: {
        before: () => {
          throw error
        },
      },
    })
    await enqueue(A, OPERATIONS.create, E1, strength())
    assert.equal((await sync(deps)).status, 'retry', error.message)
    assert.equal((await pendingOf())[0].attempts, 1)
  }
})

test('falhas transitórias repetidas: depois do limite vira failed/RETRY_LIMIT e o engine PARA de tentar sozinho', async () => {
  const server = makeServer()
  const deps = makeDeps({
    server,
    behavior: {
      before: () => {
        throw NETWORK_ERROR()
      },
    },
  })
  await enqueue(A, OPERATIONS.create, E1, strength())
  for (let i = 0; i < 10; i += 1) await sync(deps, { force: true })
  const [m] = await pendingOf()
  assert.equal(m.status, STATUS.failed)
  assert.equal(m.last_error.code, 'RETRY_LIMIT')
  const calls = deps.calls
  assert.equal((await sync(deps, { force: true })).status, 'idle') // nada pendente para enviar
  assert.equal(deps.calls, calls)
  assert.equal((await rawAll('workouts')).length, 1) // dado local intacto
  // Usuário aperta "Sincronizar agora": volta à fila e, com rede, sincroniza.
  await retryFailed(A)
  const ok = makeDeps({ server })
  assert.equal((await sync(ok, { force: true })).status, 'synced')
  assert.equal(server.rowsOf(A).length, 1)
})

test('probe sem acesso (Wi‑Fi sem saída): nada é enviado nem gasta tentativa', async () => {
  const deps = makeDeps({ server: makeServer(), behavior: { reachable: () => false } })
  await enqueue(A, OPERATIONS.create, E1, strength())
  assert.equal((await sync(deps)).status, 'unreachable')
  assert.equal(deps.calls, 0)
  assert.equal((await pendingOf())[0].attempts, 0)
})

test('navegador sabidamente offline: nem tenta', async () => {
  setBrowserOnline(false)
  const deps = makeDeps({ server: makeServer() })
  await enqueue(A, OPERATIONS.create, E1, strength())
  assert.equal((await sync(deps)).status, 'offline')
  assert.equal(deps.calls, 0)
})

// -------------------------------------------------------------------------- sessão e identidade

test('token expirado (401/JWT): a fila fica intacta, sem tentativa gasta e sem backoff', async () => {
  const server = makeServer()
  const deps = makeDeps({
    server,
    behavior: {
      before: () => {
        throw { code: 'PGRST301', message: 'JWT expired' }
      },
    },
  })
  await enqueue(A, OPERATIONS.create, E1, strength())
  const result = await sync(deps)
  assert.equal(result.status, 'auth')
  const [m] = await pendingOf()
  assert.equal(m.status, STATUS.pending)
  assert.equal(m.attempts, 0)
  assert.equal(m.next_attempt_at, null)
  assert.equal(server.rowsOf(A).length, 0)
})

test('NOT_AUTHENTICATED do servidor também é tratado como auth (não como falha permanente)', async () => {
  const deps = makeDeps({
    server: makeServer(),
    behavior: {
      before: () => {
        throw { message: 'NOT_AUTHENTICATED' }
      },
    },
  })
  await enqueue(A, OPERATIONS.create, E1, strength())
  assert.equal((await sync(deps)).status, 'auth')
  assert.equal((await pendingOf())[0].status, STATUS.pending)
})

test('APP_ACCESS_DENIED (termos pendentes etc.): fila preservada, sem tentar de novo em loop', async () => {
  const deps = makeDeps({
    server: makeServer(),
    behavior: {
      before: () => {
        throw { message: 'APP_ACCESS_DENIED' }
      },
    },
  })
  await enqueue(A, OPERATIONS.create, E1, strength())
  assert.equal((await sync(deps)).status, 'denied')
  const [m] = await pendingOf()
  assert.equal(m.attempts, 0)
  assert.equal(m.status, STATUS.pending)
})

test('SESSÃO DE OUTRO USUÁRIO não sincroniza a pendência: B só enxerga a fila de B', async () => {
  const server = makeServer()
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  const asB = makeDeps({ server, getUser: () => B })
  assert.equal((await sync(asB)).status, 'idle') // B não tem nada pendente
  assert.equal(asB.calls, 0)
  assert.equal(server.rowsOf(A).length + server.rowsOf(B).length, 0)
  assert.equal((await pendingOf(A)).length, 1)
  // B também tem uma; a de A nunca vai no lote de B.
  await enqueue(B, OPERATIONS.create, E2, strength(60))
  await sync(asB)
  assert.deepEqual(
    server.batches.flat().map((w) => w.entity_id),
    [E2]
  )
  assert.equal(server.rowsOf(B).length, 1)
  assert.equal((await pendingOf(A)).length, 1)
})

test('LOGOUT durante o sync: antes de enviar o lote a sessão é conferida; mudou -> nada é enviado e a fila volta intacta', async () => {
  const server = makeServer()
  let user = A
  const deps = makeDeps({ server, getUser: () => user })
  await enqueue(A, OPERATIONS.create, E1, strength())
  // 1ª leitura de sessão (início) = A; durante o preparo do lote o usuário sai.
  let reads = 0
  deps.getSession = async () => ({ userId: ++reads === 1 ? A : null })
  const result = await sync(deps)
  assert.equal(result.status, 'user-changed')
  assert.equal(deps.calls, 0)
  const [m] = await pendingOf()
  assert.equal(m.status, STATUS.pending)
  assert.equal(m.attempts, 0)
  assert.equal(server.rowsOf(A).length, 0)
  user = A
})

test('troca de usuário DEPOIS da conferência (no ar): o servidor recusa por USER_MISMATCH e nada é aplicado sob a identidade errada', async () => {
  const server = makeServer()
  let user = A
  const deps = makeDeps({
    server,
    getUser: () => user,
    behavior: {
      before: () => {
        user = B
      },
    },
  }) // a sessão vira B no instante do envio
  await enqueue(A, OPERATIONS.create, E1, strength())
  const result = await sync(deps)
  assert.equal(result.status, 'user-changed')
  assert.equal(server.rowsOf(A).length + server.rowsOf(B).length, 0)
  const [m] = await pendingOf(A)
  assert.equal(m.status, STATUS.pending)
  assert.equal(m.attempts, 0)
})

test('logout com resposta já a caminho: o ACK é aplicado à fila do dono (user_id da mutação), nunca a outra conta', async () => {
  const server = makeServer()
  let user = A
  const deps = makeDeps({
    server,
    getUser: () => user,
    behavior: {
      after: () => {
        user = null
      },
    },
  })
  await enqueue(A, OPERATIONS.create, E1, strength())
  assert.equal((await sync(deps)).status, 'synced')
  assert.deepEqual(await pendingOf(A), [])
  assert.deepEqual(await rawAll('outbox'), [])
})

// ------------------------------------------------------------------------------ duas abas / lock

test('DUAS ABAS: só uma sincroniza; a outra sai com "locked" e o servidor recebe o lote UMA vez', async () => {
  const server = makeServer()
  // Web Locks falso com a semântica de ifAvailable.
  const held = new Set()
  const locks = {
    async request(name, options, callback) {
      if (options.ifAvailable && held.has(name)) return callback(null)
      held.add(name)
      try {
        return await callback({ name })
      } finally {
        held.delete(name)
      }
    },
  }
  const slow = { after: () => new Promise((resolve) => setTimeout(resolve, 30)) }
  const tab1 = makeDeps({
    server,
    behavior: slow,
    extra: { withLock: (u, w) => withSyncLock(u, w, { locks }) },
  })
  const tab2 = makeDeps({ server, extra: { withLock: (u, w) => withSyncLock(u, w, { locks }) } })
  await enqueue(A, OPERATIONS.create, E1, strength())
  const [r1, r2] = await Promise.all([sync(tab1), sync(tab2)])
  assert.deepEqual([r1.status, r2.status].sort(), ['locked', 'synced'])
  assert.equal(server.batches.length, 1)
  assert.equal(server.rowsOf(A).length, 1)
})

test('locks por usuário: sincronizar A não bloqueia B', async () => {
  const held = new Set()
  const locks = {
    async request(name, o, cb) {
      if (o.ifAvailable && held.has(name)) return cb(null)
      held.add(name)
      try {
        return await cb({})
      } finally {
        held.delete(name)
      }
    },
  }
  const results = await Promise.all([
    withSyncLock(
      A,
      async () => {
        await new Promise((r) => setTimeout(r, 20))
        return 'a'
      },
      { locks }
    ),
    withSyncLock(B, async () => 'b', { locks }),
    withSyncLock(A, async () => 'a2', { locks }),
  ])
  assert.deepEqual(results, [
    { acquired: true, value: 'a' },
    { acquired: true, value: 'b' },
    { acquired: false },
  ])
})

test('sem Web Locks: a trava em memória + lease em storage impede a segunda execução; o lease expira', async () => {
  const store = new Map()
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  }
  let clock = 1000
  const opts = { locks: null, storage, now: () => clock, token: () => 'tab-1' }
  let inner
  const outer = await withSyncLock(
    A,
    async () => {
      inner = await withSyncLock(A, async () => 'não deveria rodar', opts) // mesma aba, reentrada
      return 'ok'
    },
    opts
  )
  assert.deepEqual(outer, { acquired: true, value: 'ok' })
  assert.deepEqual(inner, { acquired: false })
  assert.equal(store.size, 0) // lease liberado ao terminar

  // Outra aba segura o lease: não adquire. Lease vencido (aba morreu): adquire.
  store.set(`evolutus:sync-lease:${A}`, 'tab-x|5000')
  assert.deepEqual(await withSyncLock(A, async () => 1, { ...opts, now: () => 2000 }), {
    acquired: false,
  })
  assert.deepEqual(await withSyncLock(A, async () => 1, { ...opts, now: () => 6000 }), {
    acquired: true,
    value: 1,
  })
  assert.deepEqual(await withSyncLock('', async () => 1, opts), { acquired: false })
})

// ------------------------------------------------------------------ resultados por mutação / conflitos

test('conflito: o servidor NÃO é sobrescrito, a mutação fica failed/CONFLICT com a linha do servidor e o dado local é preservado', async () => {
  const server = makeServer()
  server.seed(
    workoutRow({
      id: E1,
      created_at: 'c0',
      updated_at: 'v2',
      set_details: [{ weight: 70, reps: 10 }],
    })
  ) // outro aparelho já mudou
  await recordWorkoutsPage(A, [workoutRow({ id: E1, created_at: 'c0', updated_at: 'v1' })], {
    now: NOW,
  })
  await enqueue(A, OPERATIONS.update, E1, strength(90), { baseUpdatedAt: 'v1' })
  const result = await sync(makeDeps({ server }))
  assert.equal(result.failed, 1)
  assert.deepEqual(server.rows.get(`${A}|${E1}`).set_details, [{ weight: 70, reps: 10 }])
  const [m] = await pendingOf()
  assert.equal(m.status, STATUS.failed)
  assert.equal(m.last_error.code, 'CONFLICT')
  assert.equal(m.last_error.server_row.updated_at, 'v2')
  assert.deepEqual((await rawAll('workouts'))[0].set_details, [{ weight: 90, reps: 10 }])
  // O usuário decide "manter o meu": reenvia com a base nova e aplica.
  await keepLocalAfterConflict(A, m.mutation_id, { now: NOW })
  assert.equal((await sync(makeDeps({ server }), { force: true })).status, 'synced')
  assert.deepEqual(server.rows.get(`${A}|${E1}`).set_details, [{ weight: 90, reps: 10 }])
})

test('rejeição permanente (payload inválido) fica failed e NÃO é reenviada em loop', async () => {
  const server = makeServer()
  const deps = makeDeps({ server })
  await enqueue(A, OPERATIONS.create, E1, strength(-5))
  const first = await sync(deps)
  assert.equal(first.failed, 1)
  assert.equal((await pendingOf())[0].last_error.code, 'INVALID_PAYLOAD')
  const calls = deps.calls
  await sync(deps, { force: true })
  assert.equal(deps.calls, calls) // nada elegível: não tenta de novo sozinho
})

test('resultado POR MUTAÇÃO: uma inválida não bloqueia as outras, e a dependente da que falhou espera (não é marcada como falha)', async () => {
  const server = makeServer()
  await enqueue(A, OPERATIONS.create, E1, strength(-5)) // inválida
  await enqueue(A, OPERATIONS.create, E2, strength(60)) // independente
  const [bad] = await claimNextBatch(A, { now: NOW, limit: 1 })
  await enqueue(A, OPERATIONS.update, E1, strength(70)) // depende da inválida (entra depois dela em andamento)
  // devolve a inválida à fila para formar um lote com as três na ordem original
  const { releaseMutations } = await import('./outbox.js')
  await releaseMutations(A, [bad.mutation_id], { countAttempt: false, now: NOW })
  const result = await sync(makeDeps({ server }), { force: true })
  assert.equal(result.applied, 1) // E2
  assert.equal(server.rowsOf(A).length, 1)
  const left = await pendingOf()
  assert.equal(
    left.find((m) => m.entity_id === E1 && m.operation === 'workout.create').status,
    STATUS.failed
  )
  const dependent = left.find((m) => m.operation === 'workout.update')
  assert.ok(dependent, 'a dependente continua na fila')
  assert.equal(dependent.status, STATUS.pending)
})

test('resposta parcial (o servidor "esqueceu" uma mutação): ela volta à fila com backoff, as outras são aplicadas', async () => {
  const server = makeServer()
  const deps = makeDeps({ server })
  const original = deps.rpc
  deps.rpc = async (...args) => {
    const response = await original(...args)
    response.results = response.results.filter((r) => r.entity_id !== E2)
    return response
  }
  await enqueue(A, OPERATIONS.create, E1, strength())
  await enqueue(A, OPERATIONS.create, E2, strength())
  const result = await sync(deps)
  assert.equal(result.applied, 1)
  assert.equal(result.status, 'retry')
  const [left] = await pendingOf()
  assert.equal(left.entity_id, E2)
  assert.equal(left.attempts, 1)
})

test('erro de lote inválido (BATCH_TOO_LARGE) marca o lote como failed com o código, sem reenvio cego', async () => {
  const deps = makeDeps({
    server: makeServer(),
    behavior: {
      before: () => {
        throw { message: 'BATCH_TOO_LARGE' }
      },
    },
  })
  await enqueue(A, OPERATIONS.create, E1, strength())
  assert.equal((await sync(deps)).status, 'failed')
  assert.equal((await pendingOf())[0].last_error.code, 'BATCH_TOO_LARGE')
})

test('CRASH no meio do envio: só sobra uma mutação "syncing"; o engine a recupera e envia (nunca fica presa)', async () => {
  const server = makeServer()
  await enqueue(A, OPERATIONS.create, E1, strength())
  await claimNextBatch(A, { now: NOW }) // aba fechou depois de marcar syncing e antes de enviar
  assert.equal((await getOutboxSummary(A)).pending, 0)
  const result = await sync(makeDeps({ server }))
  assert.equal(result.status, 'synced')
  assert.equal(server.rowsOf(A).length, 1)
  assert.deepEqual(await pendingOf(), [])
})

test('eventos entre abas: started, outbox-changed e completed/failed, sempre com o userId', async () => {
  const server = makeServer()
  const ok = makeDeps({ server })
  await enqueue(A, OPERATIONS.create, E1, strength())
  await sync(ok)
  assert.deepEqual(
    ok.events.map((e) => e.type),
    ['sync-started', 'outbox-changed', 'sync-completed']
  )
  assert.ok(ok.events.every((e) => e.userId === A))
  const bad = makeDeps({
    server,
    behavior: {
      before: () => {
        throw NETWORK_ERROR()
      },
    },
  })
  await enqueue(A, OPERATIONS.create, E2, strength())
  await sync(bad)
  assert.deepEqual(
    bad.events.map((e) => e.type),
    ['sync-started', 'outbox-changed', 'sync-failed']
  )
})

test('classifySyncError: auth, mismatch, negado, lote e transitório', () => {
  assert.equal(classifySyncError({ code: 'PGRST301', message: 'JWT expired' }), 'auth')
  assert.equal(classifySyncError({ message: 'NOT_AUTHENTICATED' }), 'auth')
  assert.equal(classifySyncError({ message: 'USER_MISMATCH' }), 'user-mismatch')
  assert.equal(classifySyncError({ message: 'APP_ACCESS_DENIED' }), 'denied')
  assert.equal(classifySyncError({ message: 'INVALID_BATCH' }), 'batch-invalid')
  assert.equal(classifySyncError({ message: 'TypeError: Failed to fetch', code: '' }), 'transient')
  assert.equal(classifySyncError({ message: 'x' }, { aborted: true }), 'transient')
  assert.equal(
    classifySyncError({ code: '42883', message: 'function does not exist' }),
    'transient'
  )
})

test('o resumo da outbox conta pendentes, falhas e a próxima tentativa', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  await enqueue(A, OPERATIONS.create, E2, strength())
  const deps = makeDeps({
    server: makeServer(),
    behavior: {
      before: () => {
        throw NETWORK_ERROR()
      },
    },
  })
  await sync(deps)
  const summary = await getOutboxSummary(A, NOW)
  assert.equal(summary.pending, 2)
  assert.equal(summary.failed, 0)
  assert.ok(summary.nextAttemptAt > NOW)
})

test('sync com filtro (Finalizar): só as mutações do treino de hoje vão; um conflito antigo NÃO bloqueia e segue na fila', async () => {
  const server = makeServer()
  // Ontem: registro que mudou em outro aparelho -> conflito.
  server.seed(workoutRow({ id: E2, date: '2026-10-04', created_at: 'c0', updated_at: 'v2' }))
  await recordWorkoutsPage(
    A,
    [workoutRow({ id: E2, date: '2026-10-04', created_at: 'c0', updated_at: 'v1' })],
    { now: NOW }
  )
  await enqueue(A, OPERATIONS.update, E2, strength(90, { date: '2026-10-04' }), {
    baseUpdatedAt: 'v1',
  })
  await sync(makeDeps({ server })) // vira failed/CONFLICT
  assert.equal((await pendingOf())[0].status, STATUS.failed)
  // Hoje: 4 alterações pendentes (4 exercícios).
  const ids = [0, 1, 2, 3].map((i) => `f000000${i}-0000-0000-0000-000000000000`)
  for (const id of ids)
    await enqueue(A, OPERATIONS.create, id, strength(40, { date: '2026-10-05' }))
  const deps = makeDeps({ server })
  const result = await sync(deps, { force: true, filter: (m) => isRelevantToDate(m, '2026-10-05') })
  assert.equal(result.applied, 4)
  assert.equal(server.rowsOf(A).length, 5) // 4 novos + o antigo que já existia
  const left = await pendingOf()
  assert.equal(left.length, 1)
  assert.equal(left[0].entity_id, E2)
  assert.equal(left[0].status, STATUS.failed) // a antiga continua lá, para o SyncStatus
  assert.deepEqual(
    server.batches.at(-1).map((w) => w.entity_id),
    ids
  ) // só as de hoje foram enviadas
})

test('o engine repassa `force` à sondagem: depois de uma falha recente, um pedido forçado tenta de verdade', async () => {
  const server = makeServer()
  await enqueue(A, OPERATIONS.create, E1, strength())
  const seen = []
  let reachable = false
  const deps = makeDeps({ server })
  deps.probe = async (options = {}) => {
    seen.push(Boolean(options.force))
    return options.force ? true : reachable // o cache "inalcançável" só é ignorado com force
  }
  assert.equal((await sync(deps)).status, 'unreachable')
  assert.equal((await sync(deps, { force: true })).status, 'synced')
  assert.deepEqual(seen, [false, true])
  assert.equal(server.rowsOf(A).length, 1)
})

test('old exercise.create is retained as a permanent failure while unrelated workouts sync', async () => {
  const old = await enqueueWorkoutMutation(A, {
    operation: OPERATIONS.create,
    entityId: E1,
    payload: strength(),
    now: NOW,
  })
  const db = await rawOpen()
  await new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite')
    const store = tx.objectStore('outbox')
    const request = store.get(old.mutation_id)
    request.onsuccess = () =>
      store.put({
        ...request.result,
        operation: 'exercise.create',
        entity_type: 'exercise',
        payload: { name: 'Criação antiga', note: 'Anotação recuperável', source: 'custom' },
      })
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  await enqueueWorkoutMutation(A, {
    operation: OPERATIONS.create,
    entityId: E2,
    payload: strength(),
    now: NOW,
  })
  const server = makeServer()
  const deps = makeDeps({ server, getUser: () => A, extra: { now: () => NOW } })
  const realRpc = deps.rpc
  deps.rpc = async (wire, userId, signal) => {
    const ordinary = wire.filter((item) => item.operation !== 'exercise.create')
    const response = ordinary.length ? await realRpc(ordinary, userId, signal) : { results: [] }
    return {
      results: [
        ...wire
          .filter((item) => item.operation === 'exercise.create')
          .map((item) => ({
            mutation_id: item.mutation_id,
            status: 'rejected',
            code: 'CUSTOM_EXERCISES_DISABLED',
          })),
        ...response.results,
      ],
    }
  }
  const result = await syncOutbox({ deps, force: true })
  assert.equal(result.failed, 1)
  assert.equal(result.applied, 1)
  const remaining = await listMutations(A)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].status, STATUS.failed)
  assert.equal(remaining[0].payload.name, 'Criação antiga')
  assert.equal(remaining[0].payload.note, 'Anotação recuperável')
  assert.equal(await retryFailed(A), 0, 'permanent exercise failure never returns to pending')
  assert.equal((await syncOutbox({ deps, force: true })).status, 'idle')
})

test('inconsistent catalog references fail definitively without discarding offline payload or blocking other workouts', async () => {
  await enqueueWorkoutMutation(A, {
    operation: OPERATIONS.create,
    entityId: E1,
    payload: strength(),
    now: NOW,
  })
  await enqueueWorkoutMutation(A, {
    operation: OPERATIONS.create,
    entityId: E2,
    payload: strength(),
    now: NOW,
  })
  const server = makeServer()
  const deps = makeDeps({ server })
  const rpc = deps.rpc
  deps.rpc = async (wire, ...args) => {
    const response = await rpc(
      wire.filter((item) => item.entity_id !== E1),
      ...args
    )
    return {
      results: [
        ...response.results,
        ...wire
          .filter((item) => item.entity_id === E1)
          .map((item) => ({
            mutation_id: item.mutation_id,
            status: 'rejected',
            code: 'catalog_exercise_not_published',
          })),
      ],
    }
  }
  const outcome = await syncOutbox({ deps, force: true })
  assert.equal(outcome.failed, 1)
  assert.equal(outcome.applied, 1)
  const [failed] = await listMutations(A)
  assert.equal(failed.status, STATUS.failed)
  assert.equal(failed.last_error.code, 'catalog_exercise_not_published')
  assert.deepEqual(failed.payload, strength())
  const calls = deps.calls
  assert.equal((await syncOutbox({ deps, force: true })).status, 'idle')
  assert.equal(deps.calls, calls, 'no automatic retry loop')
})
