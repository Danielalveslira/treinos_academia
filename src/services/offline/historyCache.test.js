import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDatabase, rawAll, withoutIndexedDb, workoutRow } from './testSupport.js'
import {
  MAX_AGE_DAYS,
  MAX_ROWS_PER_USER,
  cacheWorkoutRow,
  forgetCachedWorkout,
  readCachedWorkouts,
  recordWorkoutsPage,
} from './historyCache.js'

beforeEach(freshDatabase)

const NOW = Date.UTC(2026, 9, 5, 12) // 2026-10-05
const ids = (page) => page.rows.map((row) => row.id)

// Linhas já na ordem do servidor (date desc, created_at desc).
const sample = () => [
  workoutRow({ id: 'w5', date: '2026-10-05', created_at: '2026-10-05T11:00:00.000000+00:00' }),
  workoutRow({ id: 'w4', date: '2026-10-05', created_at: '2026-10-05T10:00:00.000000+00:00' }),
  workoutRow({
    id: 'w3',
    date: '2026-10-03',
    created_at: '2026-10-03T09:00:00.000000+00:00',
    exercise_id: 'ex-2',
  }),
  workoutRow({ id: 'w2', date: '2026-10-01', created_at: '2026-10-01T09:00:00.000000+00:00' }),
  workoutRow({
    id: 'w1',
    date: '2026-09-20',
    created_at: '2026-09-20T09:00:00.000000+00:00',
    exercise_id: 'ex-2',
  }),
]

test('sem nenhuma resposta do servidor ainda, não há o que mostrar (undefined, não "vazio")', async () => {
  assert.equal(await readCachedWorkouts('user-a'), undefined)
})

test('grava a linha como o servidor devolve (set_details jsonb + date) e lê na mesma ordem do servidor', async () => {
  const rows = sample()
  await recordWorkoutsPage('user-a', [...rows].reverse(), { now: NOW }) // ordem de gravação não importa
  const page = await readCachedWorkouts('user-a', { limit: 20 })
  assert.deepEqual(ids(page), ['w5', 'w4', 'w3', 'w2', 'w1'])
  assert.deepEqual(page.rows[0], rows[0]) // idêntica, sem conceitos novos
  assert.deepEqual(page.rows[0].set_details, [{ weight: 80, reps: 10 }])
  assert.equal(page.nextCursor, null)
  for (const forbidden of ['workout_sets', 'finished_at', 'workout_plan_id'])
    assert.ok(!(forbidden in page.rows[0]))
})

test('paginação keyset local: nextCursor aponta a última linha e a página seguinte continua dali', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  const first = await readCachedWorkouts('user-a', { limit: 2 })
  assert.deepEqual(ids(first), ['w5', 'w4'])
  assert.deepEqual(first.nextCursor, {
    date: '2026-10-05',
    createdAt: '2026-10-05T10:00:00.000000+00:00',
  })
  const second = await readCachedWorkouts('user-a', { limit: 2, cursor: first.nextCursor })
  assert.deepEqual(ids(second), ['w3', 'w2'])
  const third = await readCachedWorkouts('user-a', { limit: 2, cursor: second.nextCursor })
  assert.deepEqual(ids(third), ['w1'])
  assert.equal(third.nextCursor, null)
})

test('filtros locais iguais aos do serviço: exercício e intervalo de datas', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  assert.deepEqual(ids(await readCachedWorkouts('user-a', { filters: { exerciseId: 'ex-2' } })), [
    'w3',
    'w1',
  ])
  assert.deepEqual(
    ids(
      await readCachedWorkouts('user-a', {
        filters: { startDate: '2026-10-01', endDate: '2026-10-03' },
      })
    ),
    ['w3', 'w2']
  )
})

test('atualização: novo envio do servidor atualiza a linha existente (upsert), sem duplicar', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  const changed = workoutRow({
    id: 'w4',
    date: '2026-10-05',
    created_at: '2026-10-05T10:00:00.000000+00:00',
    set_details: [{ weight: 90, reps: 8 }],
    sets: 1,
  })
  await recordWorkoutsPage('user-a', [sample()[0], changed], { now: NOW, limit: 2 }) // página cheia: o resto fica
  const rows = (await rawAll('workouts')).filter((row) => row.user_id === 'user-a')
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.find((row) => row.id === 'w4').set_details, [{ weight: 90, reps: 8 }])
})

test('reconciliação: treino apagado no servidor sai do cache na próxima primeira página (página incompleta)', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW, limit: 20 })
  const afterDelete = sample().filter((row) => row.id !== 'w3')
  await recordWorkoutsPage('user-a', afterDelete, { now: NOW, limit: 20 })
  assert.deepEqual(ids(await readCachedWorkouts('user-a')), ['w5', 'w4', 'w2', 'w1'])
})

test('reconciliação com página CHEIA só apaga o trecho coberto: o que é mais antigo que a página fica intacto', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  // Servidor devolve só as 2 mais recentes (limit 2) e w4 sumiu: w4 (dentro do trecho) sai; w3..w1 (além da página) ficam.
  await recordWorkoutsPage('user-a', [sample()[0], sample()[2]], { now: NOW, limit: 2 })
  assert.deepEqual(ids(await readCachedWorkouts('user-a')), ['w5', 'w3', 'w2', 'w1'])
})

test('reconciliação de página com cursor só mexe abaixo do cursor', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  const cursor = { date: '2026-10-05', createdAt: '2026-10-05T10:00:00.000000+00:00' }
  // Segunda página do servidor (limit 5, incompleta): w2 foi apagada. w5/w4 estão acima do cursor e não são tocadas.
  await recordWorkoutsPage('user-a', [sample()[2], sample()[4]], { now: NOW, limit: 5, cursor })
  assert.deepEqual(ids(await readCachedWorkouts('user-a')), ['w5', 'w4', 'w3', 'w1'])
})

test('reconciliação respeita os filtros da consulta: linhas fora do filtro nunca são apagadas', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  // Consulta filtrada por ex-2 devolve só w3 (w1 foi apagada). w1 sai; as linhas de ex-1 não são tocadas.
  await recordWorkoutsPage('user-a', [sample()[2]], {
    now: NOW,
    limit: 30,
    filters: { exerciseId: 'ex-2' },
  })
  assert.deepEqual(ids(await readCachedWorkouts('user-a')), ['w5', 'w4', 'w3', 'w2'])
})

test('resposta vazia confirmada: usuário sem treinos devolve lista vazia (e não undefined)', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  await recordWorkoutsPage('user-a', [], { now: NOW, limit: 20 })
  assert.deepEqual(await readCachedWorkouts('user-a'), { rows: [], nextCursor: null })
})

test('retenção: nada mais velho que 400 dias permanece', async () => {
  const old = workoutRow({
    id: 'old',
    date: '2025-08-01',
    created_at: '2025-08-01T10:00:00.000000+00:00',
  })
  const edge = new Date(NOW - MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10)
  const keep = workoutRow({ id: 'edge', date: edge, created_at: `${edge}T10:00:00.000000+00:00` })
  await recordWorkoutsPage('user-a', [sample()[0], keep, old], { now: NOW })
  assert.deepEqual(ids(await readCachedWorkouts('user-a')), ['w5', 'edge'])
})

test('retenção: no máximo 500 linhas por usuário, sempre as mais recentes', async () => {
  const rows = Array.from({ length: MAX_ROWS_PER_USER + 25 }, (_, i) => {
    const day = new Date(NOW - i * 3600_000)
    const date = day.toISOString().slice(0, 10)
    return workoutRow({
      id: `r${String(i).padStart(4, '0')}`,
      date,
      created_at: day.toISOString().replace('Z', '000+00:00'),
    })
  })
  await recordWorkoutsPage('user-a', rows, { now: NOW })
  const stored = (await rawAll('workouts')).filter((row) => row.user_id === 'user-a')
  assert.equal(stored.length, MAX_ROWS_PER_USER)
  const keptIds = new Set(stored.map((row) => row.id))
  assert.ok(keptIds.has('r0000'))
  assert.ok(!keptIds.has(`r${MAX_ROWS_PER_USER + 24}`))
})

test('o limite de 500 vale POR USUÁRIO: o histórico de um não expulsa o do outro', async () => {
  await recordWorkoutsPage('user-b', [workoutRow({ user_id: 'user-b', id: 'b1' })], { now: NOW })
  const rows = Array.from({ length: MAX_ROWS_PER_USER + 5 }, (_, i) =>
    workoutRow({
      id: `a${i}`,
      date: '2026-10-05',
      created_at: `2026-10-05T10:00:00.${String(999999 - i).padStart(6, '0')}+00:00`,
    })
  )
  await recordWorkoutsPage('user-a', rows, { now: NOW })
  assert.deepEqual(ids(await readCachedWorkouts('user-b')), ['b1'])
})

test('isolamento: outro usuário não lê nada e linhas com user_id alheio são rejeitadas na gravação', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  assert.equal(await readCachedWorkouts('user-b'), undefined)
  assert.equal(await readCachedWorkouts(''), undefined)
  assert.equal(await readCachedWorkouts(null), undefined)

  // user-b tenta gravar com uma linha que diz ser de user-a: ignorada.
  await recordWorkoutsPage('user-b', [workoutRow({ user_id: 'user-a', id: 'intruso' })], {
    now: NOW,
  })
  assert.ok(!ids(await readCachedWorkouts('user-a')).includes('intruso'))
  assert.deepEqual(await readCachedWorkouts('user-b'), { rows: [], nextCursor: null })
})

test('a reconciliação de um usuário nunca apaga linhas de outro', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  await recordWorkoutsPage('user-b', [workoutRow({ user_id: 'user-b', id: 'b1' })], { now: NOW })
  await recordWorkoutsPage('user-b', [], { now: NOW, limit: 20 }) // b ficou sem treinos
  assert.equal(ids(await readCachedWorkouts('user-a')).length, 5)
  assert.deepEqual(ids(await readCachedWorkouts('user-b')), [])
})

test('create/update online: cacheWorkoutRow guarda a linha devolvida; delete online: forgetCachedWorkout remove', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  const created = workoutRow({
    id: 'novo',
    date: '2026-10-05',
    created_at: '2026-10-05T12:30:00.000000+00:00',
  })
  assert.equal(await cacheWorkoutRow('user-a', created, NOW), true)
  assert.deepEqual(ids(await readCachedWorkouts('user-a', { limit: 2 })), ['novo', 'w5'])
  assert.equal(await forgetCachedWorkout('user-a', 'novo'), true)
  assert.ok(!ids(await readCachedWorkouts('user-a')).includes('novo'))
  assert.equal(await cacheWorkoutRow('user-a', workoutRow({ user_id: 'user-b' }), NOW), false)
  assert.equal(await forgetCachedWorkout('user-a', ''), false)
})

test('apagar por um usuário não remove a linha de mesmo id de outro usuário', async () => {
  await recordWorkoutsPage('user-a', [workoutRow({ id: 'same' })], { now: NOW })
  await recordWorkoutsPage('user-b', [workoutRow({ user_id: 'user-b', id: 'same' })], { now: NOW })
  await forgetCachedWorkout('user-a', 'same')
  assert.deepEqual(ids(await readCachedWorkouts('user-b')), ['same'])
})

test('IndexedDB indisponível: nenhuma função lança e todas degradam para "sem cache"', async () => {
  const restore = withoutIndexedDb()
  try {
    assert.equal(await recordWorkoutsPage('user-a', sample(), { now: NOW }), false)
    assert.equal(await readCachedWorkouts('user-a'), undefined)
    assert.equal(await cacheWorkoutRow('user-a', sample()[0]), false)
    assert.equal(await forgetCachedWorkout('user-a', 'w1'), false)
  } finally {
    restore()
  }
})

test('falha no meio da gravação não deixa estado parcial: a limpeza feita ANTES da falha também é revertida', async () => {
  await recordWorkoutsPage('user-a', sample(), { now: NOW })
  const before = await rawAll('workouts')
  // Página incompleta: a reconciliação apagaria w3..w1 e só depois o put da linha não clonável falha.
  const broken = { ...sample()[1], set_details: [() => 1] }
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(await recordWorkoutsPage('user-a', [sample()[0], broken], { now: NOW }), false)
  } finally {
    console.warn = warn
  }
  assert.deepEqual(await rawAll('workouts'), before)
})
