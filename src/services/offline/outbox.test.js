import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDatabase, rawAll, workoutRow } from './testSupport.js'
import { closeDatabase } from './database.js'
import {
  MAX_ATTEMPTS,
  OPERATIONS,
  STATUS,
  backoffDelayMs,
  claimNextBatch,
  completeMutation,
  discardMutation,
  enqueueWorkoutMutation,
  failMutation,
  getOutboxSummary,
  hasPendingMutation,
  isRelevantToDate,
  keepLocalAfterConflict,
  listMutations,
  recoverStaleSyncing,
  releaseMutations,
  retryFailed,
} from './outbox.js'
import { overlayPendingWorkouts, readCachedWorkouts, recordWorkoutsPage } from './historyCache.js'
import { purgePrivateData } from './userScope.js'

beforeEach(freshDatabase)

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

const mutationsOf = async (userId) => listMutations(userId)

// ---------------------------------------------------------------- create / update / delete offline

test('create offline: grava o registro local E a mutação na mesma transação, com o id do cliente', async () => {
  const queued = await enqueue(A, OPERATIONS.create, E1, strength(80))
  assert.ok(queued.mutation_id)
  const [mutation] = await mutationsOf(A)
  assert.equal(mutation.entity_id, E1)
  assert.equal(mutation.operation, 'workout.create')
  assert.equal(mutation.status, STATUS.pending)
  assert.equal(mutation.seq, 1)
  assert.deepEqual(mutation.payload.set_details, [{ weight: 80, reps: 10 }])
  const [row] = await rawAll('workouts')
  assert.equal(row.id, E1) // o MESMO id vale no servidor: nada de mapa local->remoto
  assert.equal(row.user_id, A)
  assert.deepEqual(row.set_details, [{ weight: 80, reps: 10 }])
  assert.equal(row.sets, 1)
  for (const forbidden of ['workout_sets', 'finished_at', 'workout_plan_id'])
    assert.ok(!(forbidden in row))
})

test('create de cardio monta a linha local sem set_details', async () => {
  await enqueue(A, OPERATIONS.create, E1, {
    exercise_id: 'ex-1',
    date: '2026-10-05',
    type: 'cardio',
    set_details: null,
    sets: null,
    duration_minutes: 30,
    distance_km: 5,
    note: 'x',
  })
  const [row] = await rawAll('workouts')
  assert.equal(row.type, 'cardio')
  assert.equal(row.set_details, null)
  assert.equal(row.duration_minutes, 30)
  assert.equal(row.distance_km, 5)
})

test('update offline de um registro que já está no servidor: nova mutação com a versão-base, e a linha local muda', async () => {
  await recordWorkoutsPage(
    A,
    [workoutRow({ id: E1, updated_at: '2026-10-05T10:00:00.000000+00:00' })],
    { now: NOW }
  )
  const queued = await enqueue(A, OPERATIONS.update, E1, strength(90), {
    baseUpdatedAt: '2026-10-05T10:00:00.000000+00:00',
  })
  assert.equal(queued.compacted, null)
  const [mutation] = await mutationsOf(A)
  assert.equal(mutation.operation, 'workout.update')
  assert.equal(mutation.base_updated_at, '2026-10-05T10:00:00.000000+00:00')
  const page = await readCachedWorkouts(A)
  assert.deepEqual(page.rows[0].set_details, [{ weight: 90, reps: 10 }])
  assert.equal(page.rows[0].created_at, '2026-10-05T10:00:00.000000+00:00') // metadados preservados
})

test('delete offline: tira o registro da leitura local e enfileira o delete com a versão-base', async () => {
  await recordWorkoutsPage(
    A,
    [workoutRow({ id: E1, updated_at: '2026-10-05T10:00:00.000000+00:00' })],
    { now: NOW }
  )
  await enqueue(A, OPERATIONS.delete, E1, null, {
    baseUpdatedAt: '2026-10-05T10:00:00.000000+00:00',
  })
  assert.deepEqual((await readCachedWorkouts(A)).rows, [])
  const [mutation] = await mutationsOf(A)
  assert.equal(mutation.operation, 'workout.delete')
  assert.equal(mutation.payload, null)
})

test('validações do enfileiramento: operação desconhecida, payload ausente e ids vazios são recusados', async () => {
  await assert.rejects(enqueue(A, 'workout.truncate', E1, strength()), /não suportada/)
  await assert.rejects(enqueue(A, OPERATIONS.create, E1, null), /payload/)
  await assert.rejects(enqueue('', OPERATIONS.create, E1, strength()), /obrigatórios/)
  await assert.rejects(enqueue(A, OPERATIONS.create, '', strength()), /obrigatórios/)
  assert.deepEqual(await mutationsOf(A), [])
})

test('criar duas vezes o mesmo id enfileirado é recusado (nada de duplicar localmente)', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  await assert.rejects(enqueue(A, OPERATIONS.create, E1, strength()), /ENTITY_ALREADY_QUEUED/)
})

test('editar um registro que está para ser apagado é recusado', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: E1 })], { now: NOW })
  await enqueue(A, OPERATIONS.delete, E1, null)
  await assert.rejects(enqueue(A, OPERATIONS.update, E1, strength()), /ENTITY_DELETED/)
})

// ------------------------------------------------------------------------------------ compactação

test('compactação: create + update + update = UM create com o estado final', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  const second = await enqueue(A, OPERATIONS.update, E1, strength(82))
  await enqueue(A, OPERATIONS.update, E1, strength(84, { note: 'final' }))
  assert.equal(second.compacted, 'merged')
  const all = await mutationsOf(A)
  assert.equal(all.length, 1)
  assert.equal(all[0].operation, 'workout.create')
  assert.deepEqual(all[0].payload.set_details, [{ weight: 84, reps: 10 }])
  assert.equal(all[0].payload.note, 'final')
  assert.equal(all[0].base_updated_at, null)
  assert.deepEqual((await rawAll('workouts'))[0].set_details, [{ weight: 84, reps: 10 }])
})

test('compactação: update + update = UM update com o payload final e a versão-base MAIS ANTIGA', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: E1, updated_at: 'v1' })], { now: NOW })
  await enqueue(A, OPERATIONS.update, E1, strength(90), { baseUpdatedAt: 'v1' })
  await enqueue(A, OPERATIONS.update, E1, strength(95), { baseUpdatedAt: 'v-ignorada' })
  const all = await mutationsOf(A)
  assert.equal(all.length, 1)
  assert.equal(all[0].base_updated_at, 'v1')
  assert.deepEqual(all[0].payload.set_details, [{ weight: 95, reps: 10 }])
})

test('compactação: create + delete (o servidor nunca soube) = NADA a enviar, e o registro local some', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  const result = await enqueue(A, OPERATIONS.delete, E1, null)
  assert.equal(result.compacted, 'cancelled')
  assert.equal(result.mutation_id, null)
  assert.deepEqual(await mutationsOf(A), [])
  assert.deepEqual(await rawAll('workouts'), [])
})

test('compactação: create + update + delete também some por completo', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  await enqueue(A, OPERATIONS.update, E1, strength(99))
  await enqueue(A, OPERATIONS.delete, E1, null)
  assert.deepEqual(await mutationsOf(A), [])
  assert.deepEqual(await rawAll('workouts'), [])
})

test('compactação: update + delete = UM delete, mantendo a versão-base', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: E1, updated_at: 'v1' })], { now: NOW })
  await enqueue(A, OPERATIONS.update, E1, strength(90), { baseUpdatedAt: 'v1' })
  const result = await enqueue(A, OPERATIONS.delete, E1, null)
  assert.equal(result.compacted, 'replaced')
  const all = await mutationsOf(A)
  assert.equal(all.length, 1)
  assert.equal(all[0].operation, 'workout.delete')
  assert.equal(all[0].base_updated_at, 'v1')
  assert.equal(all[0].payload, null)
})

test('compactação: delete repetido é idempotente', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: E1, updated_at: 'v1' })], { now: NOW })
  await enqueue(A, OPERATIONS.delete, E1, null)
  const again = await enqueue(A, OPERATIONS.delete, E1, null)
  assert.equal(again.compacted, 'noop')
  assert.equal((await mutationsOf(A)).length, 1)
})

test('compactação NÃO toca uma mutação em andamento (syncing): a nova entra depois dela', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  const [claimed] = await claimNextBatch(A, { now: NOW })
  assert.equal(claimed.status, STATUS.syncing)
  const result = await enqueue(A, OPERATIONS.update, E1, strength(85))
  assert.equal(result.compacted, null)
  const all = await mutationsOf(A)
  assert.equal(all.length, 2)
  assert.deepEqual(all[0].payload.set_details, [{ weight: 80, reps: 10 }]) // a que está indo ao servidor segue intacta
  assert.equal(all[1].operation, 'workout.update')
  assert.equal(all[1].seq, all[0].seq + 1)
})

test('compactação não mistura registros diferentes', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  await enqueue(A, OPERATIONS.create, E2, strength(60))
  await enqueue(A, OPERATIONS.update, E1, strength(81))
  const all = await mutationsOf(A)
  assert.equal(all.length, 2)
  assert.deepEqual(
    all.map((m) => m.entity_id),
    [E1, E2]
  )
})

test('editar de novo uma mutação que falhou a recoloca na fila com o estado novo', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(-5))
  const [m] = await mutationsOf(A)
  await claimNextBatch(A, { now: NOW })
  await failMutation(A, m.mutation_id, { code: 'INVALID_PAYLOAD' }, NOW)
  await enqueue(A, OPERATIONS.update, E1, strength(50))
  const [after] = await mutationsOf(A)
  assert.equal(after.status, STATUS.pending)
  assert.equal(after.last_error, null)
  assert.equal(after.attempts, 0)
  assert.deepEqual(after.payload.set_details, [{ weight: 50, reps: 10 }])
})

// ------------------------------------------------------------------------------------------ ordem

test('seq é estritamente crescente por usuário e independente entre usuários', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  await enqueue(B, OPERATIONS.create, E1, strength())
  await enqueue(A, OPERATIONS.create, E2, strength())
  assert.deepEqual(
    (await mutationsOf(A)).map((m) => m.seq),
    [1, 2]
  )
  assert.deepEqual(
    (await mutationsOf(B)).map((m) => m.seq),
    [1]
  )
})

test('o lote sai em ordem de seq e update NUNCA sai antes do create do mesmo registro', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  await enqueue(A, OPERATIONS.create, E2, strength())
  const first = await claimNextBatch(A, { now: NOW, limit: 1 })
  assert.deepEqual(
    first.map((m) => m.entity_id),
    [E1]
  )
  // E1 está em andamento: um update novo de E1 entra DEPOIS e não pode sair no mesmo lote que o create.
  await enqueue(A, OPERATIONS.update, E1, strength(99))
  const second = await claimNextBatch(A, { now: NOW })
  assert.deepEqual(
    second.map((m) => `${m.operation}:${m.entity_id}`),
    [`workout.create:${E2}`]
  )
  const third = await claimNextBatch(A, { now: NOW })
  assert.deepEqual(third, []) // o update de E1 espera o create de E1 ser confirmado
})

test('uma mutação falha bloqueia as seguintes do MESMO registro, mas não as de outros', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  await enqueue(A, OPERATIONS.create, E2, strength())
  const [m1] = await claimNextBatch(A, { now: NOW, limit: 1 }) // create de E1 em andamento
  await enqueue(A, OPERATIONS.update, E1, strength(70)) // entra DEPOIS do create em andamento
  await failMutation(A, m1.mutation_id, { code: 'INVALID_PAYLOAD' }, NOW)
  const batch = await claimNextBatch(A, { now: NOW })
  assert.deepEqual(
    batch.map((m) => m.entity_id),
    [E2]
  ) // o update de E1 espera a resolução do create falho
})

test('backoff: mutação em espera não sai (exceto force) e o delay cresce com jitter limitado', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  const [m] = await claimNextBatch(A, { now: NOW })
  await releaseMutations(A, [m.mutation_id], { now: NOW, random: () => 0.5 })
  const [waiting] = await mutationsOf(A)
  assert.equal(waiting.status, STATUS.pending)
  assert.equal(waiting.next_attempt_at, NOW + backoffDelayMs(1, () => 0.5))
  assert.deepEqual(await claimNextBatch(A, { now: NOW + 1000 }), [])
  assert.equal((await claimNextBatch(A, { now: NOW + 1000, force: true })).length, 1)
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => backoffDelayMs(n, () => 0.5) / 1000),
    [2, 5, 15, 30, 60, 120, 300, 300]
  )
  assert.ok(backoffDelayMs(3, () => 0) < backoffDelayMs(3, () => 0.999))
  assert.ok(
    backoffDelayMs(3, () => 0) >= 15000 * 0.8 && backoffDelayMs(3, () => 0.999) <= 15000 * 1.2
  )
})

test('depois de MAX_ATTEMPTS falhas transitórias vira failed/RETRY_LIMIT (para de tentar sozinha, mas NÃO descarta)', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const [m] = await claimNextBatch(A, { now: NOW, force: true })
    await releaseMutations(A, [m.mutation_id], { now: NOW })
  }
  const [m] = await mutationsOf(A)
  assert.equal(m.status, STATUS.failed)
  assert.equal(m.last_error.code, 'RETRY_LIMIT')
  assert.deepEqual(await claimNextBatch(A, { now: NOW, force: true }), [])
  assert.equal(await retryFailed(A), 1) // "Sincronizar agora" a recoloca na fila
  const [again] = await mutationsOf(A)
  assert.equal(again.status, STATUS.pending)
  assert.equal(again.attempts, 0)
  assert.deepEqual(
    (await rawAll('workouts')).map((r) => r.id),
    [E1]
  ) // dados locais intactos
})

test('auth/troca de usuário (countAttempt:false) não gasta tentativa nem aplica espera', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  const [m] = await claimNextBatch(A, { now: NOW })
  await releaseMutations(A, [m.mutation_id], { countAttempt: false, now: NOW })
  const [after] = await mutationsOf(A)
  assert.equal(after.attempts, 0)
  assert.equal(after.next_attempt_at, null)
  assert.equal(after.status, STATUS.pending)
})

test('crash/reload no meio do envio: syncing abandonado volta à fila; a tentativa CONTA e a 1ª não espera', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  await claimNextBatch(A, { now: NOW })
  assert.equal(await recoverStaleSyncing(A, NOW), 1)
  const [m] = await mutationsOf(A)
  assert.equal(m.status, STATUS.pending)
  assert.equal(m.attempts, 1) // o envio chegou a começar
  assert.equal(m.next_attempt_at, null) // 1ª: tenta de novo já
})

test('syncing abandonado de novo e de novo: aplica backoff e, no limite, vira failed/RETRY_LIMIT (sem crash-loop eterno)', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const [claimed] = await claimNextBatch(A, { now: NOW, force: true })
    assert.equal(claimed.attempts, i)
    await recoverStaleSyncing(A, NOW, () => 0.5)
    const [after] = await mutationsOf(A)
    if (i < MAX_ATTEMPTS) {
      assert.equal(after.status, STATUS.pending)
      assert.equal(after.next_attempt_at, i > 1 ? NOW + backoffDelayMs(i, () => 0.5) : null)
    }
  }
  const [final] = await mutationsOf(A)
  assert.equal(final.status, STATUS.failed)
  assert.equal(final.last_error.code, 'RETRY_LIMIT')
  assert.deepEqual(
    (await rawAll('workouts')).map((r) => r.id),
    [E1]
  ) // dado local intacto
})

test('recoverStaleSyncing só mexe nas mutações do usuário informado', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  await enqueue(B, OPERATIONS.create, E1, strength())
  await claimNextBatch(A, { now: NOW })
  await claimNextBatch(B, { now: NOW })
  assert.equal(await recoverStaleSyncing(A, NOW), 1)
  assert.equal((await mutationsOf(A))[0].status, STATUS.pending)
  assert.equal((await mutationsOf(B))[0].status, STATUS.syncing)
})

// -------------------------------------------------------------------------------- ACK e resolução

test('ACK de create: remove a mutação e grava a linha OFICIAL do servidor (created_at/updated_at dele)', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  const [m] = await claimNextBatch(A, { now: NOW })
  const serverRow = workoutRow({
    id: E1,
    created_at: '2026-10-05T12:30:00.000000+00:00',
    updated_at: '2026-10-05T12:30:00.000000+00:00',
  })
  await completeMutation(
    A,
    m,
    { status: 'applied', server_updated_at: serverRow.updated_at, row: serverRow },
    NOW
  )
  assert.deepEqual(await mutationsOf(A), [])
  const [row] = await rawAll('workouts')
  assert.equal(row.created_at, '2026-10-05T12:30:00.000000+00:00')
  assert.equal(row.updated_at, '2026-10-05T12:30:00.000000+00:00')
})

test('ACK rebaseia as mutações seguintes do mesmo registro na versão nova do servidor', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  const [m] = await claimNextBatch(A, { now: NOW })
  await enqueue(A, OPERATIONS.update, E1, strength(85))
  await completeMutation(
    A,
    m,
    {
      status: 'applied',
      server_updated_at: 'srv-v1',
      row: workoutRow({ id: E1, updated_at: 'srv-v1' }),
    },
    NOW
  )
  const [next] = await mutationsOf(A)
  assert.equal(next.operation, 'workout.update')
  assert.equal(next.base_updated_at, 'srv-v1')
  // a linha local segue refletindo o que o usuário quer (85), só com a versão nova
  const [row] = await rawAll('workouts')
  assert.deepEqual(row.set_details, [{ weight: 85, reps: 10 }])
  assert.equal(row.updated_at, 'srv-v1')
})

test('ACK de delete remove a mutação e não ressuscita o registro', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: E1, updated_at: 'v1' })], { now: NOW })
  await enqueue(A, OPERATIONS.delete, E1, null)
  const [m] = await claimNextBatch(A, { now: NOW })
  await completeMutation(A, m, { status: 'applied' }, NOW)
  assert.deepEqual(await mutationsOf(A), [])
  assert.deepEqual(await rawAll('workouts'), [])
})

test('conflito: fica failed com a linha do servidor guardada e os dados locais preservados', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: E1, updated_at: 'v1' })], { now: NOW })
  await enqueue(A, OPERATIONS.update, E1, strength(90), { baseUpdatedAt: 'v1' })
  const [m] = await claimNextBatch(A, { now: NOW })
  const serverRow = workoutRow({
    id: E1,
    updated_at: 'v2',
    set_details: [{ weight: 70, reps: 10 }],
  })
  await failMutation(A, m.mutation_id, { code: 'CONFLICT', serverRow }, NOW)
  const [failed] = await mutationsOf(A)
  assert.equal(failed.status, STATUS.failed)
  assert.equal(failed.last_error.code, 'CONFLICT')
  assert.equal(failed.last_error.server_row.updated_at, 'v2')
  assert.deepEqual((await rawAll('workouts'))[0].set_details, [{ weight: 90, reps: 10 }]) // o meu continua aqui
})

test('"manter o meu": reenvia usando a versão atual do servidor como base', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: E1, updated_at: 'v1' })], { now: NOW })
  await enqueue(A, OPERATIONS.update, E1, strength(90), { baseUpdatedAt: 'v1' })
  const [m] = await claimNextBatch(A, { now: NOW })
  await failMutation(
    A,
    m.mutation_id,
    { code: 'CONFLICT', serverRow: workoutRow({ id: E1, updated_at: 'v2' }) },
    NOW
  )
  assert.equal(await keepLocalAfterConflict(A, m.mutation_id, { now: NOW }), true)
  const [after] = await mutationsOf(A)
  assert.equal(after.status, STATUS.pending)
  assert.equal(after.base_updated_at, 'v2')
})

test('"usar o do servidor": descarta a mudança local e restaura a versão do servidor', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: E1, updated_at: 'v1' })], { now: NOW })
  await enqueue(A, OPERATIONS.update, E1, strength(90), { baseUpdatedAt: 'v1' })
  const [m] = await claimNextBatch(A, { now: NOW })
  await failMutation(
    A,
    m.mutation_id,
    {
      code: 'CONFLICT',
      serverRow: workoutRow({ id: E1, updated_at: 'v2', set_details: [{ weight: 70, reps: 10 }] }),
    },
    NOW
  )
  assert.equal(await discardMutation(A, m.mutation_id), true)
  assert.deepEqual(await mutationsOf(A), [])
  assert.deepEqual((await rawAll('workouts'))[0].set_details, [{ weight: 70, reps: 10 }])
})

test('descartar um create que nunca chegou ao servidor remove o registro local; outro usuário não consegue descartar', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  const [m] = await mutationsOf(A)
  assert.equal(await discardMutation(B, m.mutation_id), false)
  assert.equal((await mutationsOf(A)).length, 1)
  assert.equal(await discardMutation(A, m.mutation_id), true)
  assert.deepEqual(await rawAll('workouts'), [])
})

test('failMutation/releaseMutations/keepLocal de outro usuário não têm efeito', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  const [m] = await claimNextBatch(A, { now: NOW })
  assert.equal(await failMutation(B, m.mutation_id, { code: 'X' }, NOW), false)
  assert.deepEqual(await releaseMutations(B, [m.mutation_id], { now: NOW }), [])
  assert.equal((await mutationsOf(A))[0].status, STATUS.syncing)
})

// ------------------------------------------------------------------------- isolamento por usuário

test('a outbox de um usuário nunca é lida, contada nem entregue a outro', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength())
  assert.deepEqual(await mutationsOf(B), [])
  assert.deepEqual(await claimNextBatch(B, { now: NOW }), [])
  assert.equal((await getOutboxSummary(B)).total, 0)
  assert.equal(await hasPendingMutation(B, E1), false)
  assert.equal(await hasPendingMutation(A, E1), true)
  assert.deepEqual(await mutationsOf(''), [])
})

test('mesmo entity_id em contas diferentes não se mistura (compactação e claim são por usuário)', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(10))
  await enqueue(B, OPERATIONS.create, E1, strength(20))
  await enqueue(A, OPERATIONS.update, E1, strength(11))
  assert.equal((await mutationsOf(A)).length, 1)
  assert.deepEqual((await mutationsOf(B))[0].payload.set_details, [{ weight: 20, reps: 10 }])
})

// ----------------------------------------------------------- logout, sessão expirada e reabertura

test('LOGOUT: o cache privado é apagado, a outbox e os registros que ela carrega SOBREVIVEM', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: 'srv-1' })], { now: NOW })
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  await purgePrivateData(null)
  assert.equal((await mutationsOf(A)).length, 1)
  assert.deepEqual(
    (await rawAll('workouts')).map((r) => r.id),
    [E1]
  ) // 'srv-1' era cache e saiu; E1 é trabalho do usuário
  // Do cache do servidor nada é legível após o logout; só o que a outbox ainda carrega (trabalho do dono).
  const visible = await readCachedWorkouts(A)
  assert.deepEqual(
    visible.rows.map((r) => r.id),
    [E1]
  )
  assert.equal(await readCachedWorkouts(B), undefined) // e outra conta não lê nada
})

test('TROCA DE CONTA: o cache de A sai, a outbox de A fica guardada e B não a enxerga', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  await recordWorkoutsPage(B, [workoutRow({ user_id: B, id: 'b-1' })], { now: NOW })
  await purgePrivateData(B)
  assert.equal((await mutationsOf(A)).length, 1)
  assert.deepEqual(await mutationsOf(B), [])
  assert.deepEqual(
    (await readCachedWorkouts(B)).rows.map((r) => r.id),
    ['b-1']
  )
  assert.deepEqual(await claimNextBatch(B, { now: NOW }), [])
})

test('SESSÃO EXPIRADA (SIGNED_OUT sem logout do usuário): a limpeza roda e a outbox continua inteira', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  await enqueue(A, OPERATIONS.delete, E2, null)
  const before = await rawAll('outbox')
  await purgePrivateData(null)
  await purgePrivateData(null)
  assert.deepEqual(await rawAll('outbox'), before)
})

test('FECHAR E REABRIR o navegador preserva as pendências (ordem, status e tentativas)', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  await enqueue(A, OPERATIONS.create, E2, strength(60))
  const [claimed] = await claimNextBatch(A, { now: NOW, limit: 1 })
  await releaseMutations(A, [claimed.mutation_id], { now: NOW })
  const before = await mutationsOf(A)
  await closeDatabase()
  const after = await mutationsOf(A)
  assert.deepEqual(after, before)
  assert.deepEqual(await getOutboxSummary(A, NOW), {
    total: 2,
    pending: 2,
    syncing: 0,
    failed: 0,
    oldestPendingAt: before[0].created_at,
    nextAttemptAt: before[0].next_attempt_at,
  })
})

test('o cache descartável pode ser apagado SEM apagar a outbox', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: 'srv-1' })], { now: NOW })
  await enqueue(A, OPERATIONS.update, 'srv-1', strength(90), { baseUpdatedAt: null })
  await purgePrivateData(null)
  assert.equal((await rawAll('outbox')).length, 1)
  assert.equal((await rawAll('workouts')).length, 1) // a linha com mutação pendente fica; sem ela o usuário perderia a edição
})

// -------------------------------------- leituras do servidor não destroem o que está pendente

test('uma página do servidor NÃO sobrescreve nem apaga o registro com mutação pendente', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: E1, updated_at: 'v1' })], { now: NOW })
  await enqueue(A, OPERATIONS.update, E1, strength(90), { baseUpdatedAt: 'v1' })
  await enqueue(A, OPERATIONS.create, E2, strength(60), { now: NOW })
  // Servidor devolve o E1 antigo e nada de E2 (que ele não conhece), página incompleta => reconcilia.
  await recordWorkoutsPage(A, [workoutRow({ id: E1, updated_at: 'v1' })], { now: NOW, limit: 20 })
  const rows = (await readCachedWorkouts(A)).rows
  assert.deepEqual(rows.map((r) => r.id).sort(), [E1, E2].sort())
  assert.deepEqual(rows.find((r) => r.id === E1).set_details, [{ weight: 90, reps: 10 }])
})

test('overlay: servidor + pendências = o que o usuário vê (create novo, edição, exclusão)', async () => {
  const server = [
    workoutRow({ id: 's1', date: '2026-10-04', created_at: '2026-10-04T10:00:00.000000+00:00' }),
    workoutRow({ id: 's2', date: '2026-10-03', created_at: '2026-10-03T10:00:00.000000+00:00' }),
  ]
  await recordWorkoutsPage(A, server, { now: NOW })
  await enqueue(A, OPERATIONS.create, E1, strength(80), { now: NOW })
  await enqueue(A, OPERATIONS.update, 's1', strength(95, { date: '2026-10-04' }), {
    baseUpdatedAt: null,
  })
  await enqueue(A, OPERATIONS.delete, 's2', null)
  const view = await overlayPendingWorkouts(A, server, { limit: 20 })
  assert.deepEqual(
    view.map((r) => r.id),
    [E1, 's1']
  )
  assert.deepEqual(view.find((r) => r.id === 's1').set_details, [{ weight: 95, reps: 10 }])
})

test('overlay sem pendências devolve exatamente as linhas do servidor, e o de outro usuário não vaza', async () => {
  const server = [workoutRow({ id: 's1' })]
  assert.equal(await overlayPendingWorkouts(A, server, { limit: 20 }), server)
  await enqueue(A, OPERATIONS.create, E1, strength(80))
  assert.equal(await overlayPendingWorkouts(B, server, { limit: 20 }), server)
})

test('overlay respeita os filtros: edição que sai do filtro some da consulta; pendência fora do intervalo não entra', async () => {
  const server = [workoutRow({ id: 's1', exercise_id: 'ex-1' })]
  await recordWorkoutsPage(A, server, { now: NOW })
  await enqueue(A, OPERATIONS.update, 's1', strength(80, { exercise_id: 'ex-2' }), {
    baseUpdatedAt: null,
  })
  const forEx1 = await overlayPendingWorkouts(A, server, {
    filters: { exerciseId: 'ex-1' },
    limit: 20,
  })
  assert.deepEqual(forEx1, [])
  await enqueue(A, OPERATIONS.create, E1, strength(70, { date: '2026-01-01' }))
  const recent = await overlayPendingWorkouts(A, [], {
    filters: { startDate: '2026-10-01' },
    limit: 20,
  })
  assert.ok(!recent.some((r) => r.id === E1))
})

// ------------------------------------------------------------- relevância por dia (Finalizar treino)

test('cada mutação registra os dias que toca; edição que muda o treino de dia toca os dois', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: E1, date: '2026-10-04', updated_at: 'v1' })], {
    now: NOW,
  })
  await enqueue(A, OPERATIONS.create, E2, strength(60, { date: '2026-10-05' }))
  await enqueue(A, OPERATIONS.update, E1, strength(70, { date: '2026-10-05' }), {
    baseUpdatedAt: 'v1',
  })
  const all = await mutationsOf(A)
  assert.deepEqual(all.find((m) => m.entity_id === E2).dates, ['2026-10-05'])
  assert.deepEqual(all.find((m) => m.entity_id === E1).dates, ['2026-10-04', '2026-10-05'])
  // delete de registro conhecido herda o dia da linha local; compactação une os dias
  await enqueue(A, OPERATIONS.delete, E1, null)
  assert.deepEqual((await mutationsOf(A)).find((m) => m.entity_id === E1).dates, [
    '2026-10-04',
    '2026-10-05',
  ])
})

test('isRelevantToDate: só as do dia; sem data conhecida conta como relevante (na dúvida, nunca finaliza sem ela)', () => {
  assert.equal(isRelevantToDate({ dates: ['2026-10-05'] }, '2026-10-05'), true)
  assert.equal(isRelevantToDate({ dates: ['2026-10-04'] }, '2026-10-05'), false)
  assert.equal(isRelevantToDate({ dates: ['2026-10-04', '2026-10-05'] }, '2026-10-05'), true)
  assert.equal(isRelevantToDate({ dates: [] }, '2026-10-05'), true)
  assert.equal(isRelevantToDate({}, '2026-10-05'), true)
})

test('claimNextBatch com filtro: só sai o que casa, e o que ficou de fora segura as seguintes do MESMO registro', async () => {
  await enqueue(A, OPERATIONS.create, E1, strength(10, { date: '2026-10-04' })) // ontem
  await enqueue(A, OPERATIONS.create, E2, strength(20, { date: '2026-10-05' })) // hoje
  const today = (m) => isRelevantToDate(m, '2026-10-05')
  const batch = await claimNextBatch(A, { now: NOW, filter: today })
  assert.deepEqual(
    batch.map((m) => m.entity_id),
    [E2]
  )
  assert.equal((await mutationsOf(A)).find((m) => m.entity_id === E1).status, STATUS.pending) // intocada
})

test('SEM a marca de "histórico confirmado" (limpeza de cache/sessão expirada) o que está PENDENTE continua legível offline; o resto não', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: 'srv-1', updated_at: 'v1' })], { now: NOW }) // cache do servidor
  await enqueue(A, OPERATIONS.create, E1, strength(80)) // salvo offline
  await enqueue(A, OPERATIONS.update, 'srv-1', strength(95), { baseUpdatedAt: 'v1' }) // editado offline
  await purgePrivateData(null) // SIGNED_OUT sem rede: tira a marca e o cache; fica o que a outbox carrega
  const page = await readCachedWorkouts(A, { limit: 20 })
  assert.ok(page, 'o trabalho pendente não pode sumir da tela')
  assert.deepEqual(page.rows.map((r) => r.id).sort(), [E1, 'srv-1'].sort())
  assert.deepEqual(page.rows.find((r) => r.id === 'srv-1').set_details, [{ weight: 95, reps: 10 }])
  // Filtros continuam valendo e outro usuário não vê nada.
  assert.deepEqual(
    (await readCachedWorkouts(A, { filters: { exerciseId: 'nao-existe' } })).rows,
    []
  )
  assert.equal(await readCachedWorkouts(B), undefined)
})

test('sem a marca e SEM pendências continua não havendo histórico para mostrar (nada de "vazio" inventado)', async () => {
  await recordWorkoutsPage(A, [workoutRow({ id: 'srv-1' })], { now: NOW })
  await purgePrivateData(null)
  assert.equal(await readCachedWorkouts(A), undefined)
})
