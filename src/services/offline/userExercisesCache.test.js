import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDatabase, rawAll, withoutIndexedDb } from './testSupport.js'
import { readCachedUserExercises, replaceCachedUserExercises } from './userExercisesCache.js'

beforeEach(freshDatabase)

const row = (userId, id, name = id) => ({
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

test('nunca confirmada pelo servidor: undefined; lista vazia confirmada: []', async () => {
  assert.equal(await readCachedUserExercises('user-a'), undefined)
  assert.equal(await replaceCachedUserExercises('user-a', []), true)
  assert.deepEqual(await readCachedUserExercises('user-a'), [])
})

test('cada resposta SUBSTITUI a lista do usuário: o que foi apagado no servidor sai, sem duplicar', async () => {
  await replaceCachedUserExercises('user-a', [row('user-a', 'e1'), row('user-a', 'e2')])
  await replaceCachedUserExercises('user-a', [
    row('user-a', 'e2', 'Renomeado'),
    row('user-a', 'e3'),
  ])
  const list = await readCachedUserExercises('user-a')
  assert.deepEqual(list.map((e) => e.id).sort(), ['e2', 'e3'])
  assert.equal(list.find((e) => e.id === 'e2').name, 'Renomeado')
})

test('isolamento: substituir a lista de um usuário nunca toca a do outro, e leitura é sempre por user_id', async () => {
  await replaceCachedUserExercises('user-a', [row('user-a', 'e1')])
  await replaceCachedUserExercises('user-b', [row('user-b', 'x1'), row('user-b', 'x2')])
  await replaceCachedUserExercises('user-b', [])
  assert.deepEqual(
    (await readCachedUserExercises('user-a')).map((e) => e.id),
    ['e1']
  )
  assert.deepEqual(await readCachedUserExercises('user-b'), [])
  assert.equal(await readCachedUserExercises('user-c'), undefined)
  assert.equal(await readCachedUserExercises(''), undefined)
})

test('linhas com user_id alheio ou sem id são ignoradas', async () => {
  await replaceCachedUserExercises('user-a', [
    row('user-b', 'intruso'),
    { user_id: 'user-a' },
    row('user-a', 'ok'),
  ])
  assert.deepEqual(
    (await rawAll('userExercises')).map((e) => e.id),
    ['ok']
  )
})

test('IndexedDB indisponível: não lança', async () => {
  const restore = withoutIndexedDb()
  try {
    assert.equal(await replaceCachedUserExercises('user-a', [row('user-a', 'e1')]), false)
    assert.equal(await readCachedUserExercises('user-a'), undefined)
  } finally {
    restore()
  }
})
