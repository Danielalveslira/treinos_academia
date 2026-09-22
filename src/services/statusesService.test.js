import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function service(docs = []) {
  const { outputFiles } = await build({
    entryPoints: ['src/services/statusesService.js'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'firebase-fixture',
        setup(pluginBuild) {
          pluginBuild.onResolve(
            {
              filter: /firebase\/firestore|firebase\/functions|firebase\/storage|firebase\/config$/,
            },
            (args) => ({ path: args.path, namespace: 'fixture' })
          )
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
            if (path.endsWith('config')) {
              return {
                contents:
                  'export const db = {}; export const storage = {}; export const functions = {}',
              }
            }
            if (path.endsWith('functions')) {
              return { contents: 'export const httpsCallable = () => async () => ({ data: null })' }
            }
            if (path.endsWith('storage')) {
              return {
                contents:
                  'export const ref = () => ({}); export const uploadBytesResumable = () => ({}); export const getBytes = async () => new Uint8Array()',
              }
            }
            return {
              contents: `
                const DOCS = ${JSON.stringify(docs)}
                export const Timestamp = {
                  now: () => 1000,
                  fromMillis: (value) => value,
                  fromDate: (value) => value.getTime(),
                }
                export const collection = (_db, name) => ({ name })
                export const where = (field, op, value) => ({ type: 'where', field, op, value })
                export const orderBy = (field, dir) => ({ type: 'orderBy', field, dir })
                export const limit = (value) => ({ type: 'limit', value })
                export const query = (base, ...clauses) => ({ name: base.name, clauses })
                const fieldValue = (item, path) => path.split('.').reduce((value, key) => value?.[key], item)
                export const getDocs = async (request) => {
                  globalThis.__statusQueries.push(request)
                  let items = DOCS.slice()
                  for (const clause of request.clauses) {
                    if (clause.type === 'where') {
                      items = items.filter((item) => {
                        const value = fieldValue(item, clause.field)
                        return clause.op === '==' ? value === clause.value : value > clause.value
                      })
                    }
                  }
                  const ordering = request.clauses.find((clause) => clause.type === 'orderBy')
                  if (ordering) items.sort((a, b) => fieldValue(a, ordering.field) - fieldValue(b, ordering.field))
                  const cap = request.clauses.find((clause) => clause.type === 'limit')
                  if (cap) items = items.slice(0, cap.value)
                  return { docs: items.map((item) => ({ id: item.id, data: () => item })) }
                }
                export const addDoc = async () => ({ id: 'new' })
                export const deleteDoc = async () => undefined
                export const doc = (...parts) => parts
                export const getDoc = async (request) => {
                  const statusId = request.at(-1)
                  const item = DOCS.find((candidate) => candidate.id === statusId)
                  return { exists: () => Boolean(item), id: statusId, data: () => item }
                }
                export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) })
                export const setDoc = async () => undefined
                export const serverTimestamp = () => 1000
              `,
            }
          })
        },
      },
    ],
  })
  globalThis.__statusQueries = []
  const api = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  )
  return { api, queries: globalThis.__statusQueries }
}

test('upcoming workouts query filters by community/type/date, orders ascending and limits to 20', async () => {
  const docs = [
    { id: 'later', communityId: 'c1', type: 'workout', workout: { date: 5000 } },
    { id: 'soon', communityId: 'c1', type: 'workout', workout: { date: 2000 } },
    { id: 'past', communityId: 'c1', type: 'workout', workout: { date: 500 } },
    { id: 'text', communityId: 'c1', type: 'text', workout: { date: 3000 } },
    { id: 'other', communityId: 'c2', type: 'workout', workout: { date: 1500 } },
  ]
  const { api, queries } = await service(docs)
  const result = await api.listUpcomingWorkouts('c1')

  assert.deepEqual(
    result.map((status) => status.id),
    ['soon', 'later']
  )
  const clauses = queries[0].clauses
  assert.deepEqual(
    clauses.map((clause) => [clause.type, clause.field, clause.op, clause.dir, clause.value]),
    [
      ['where', 'communityId', '==', undefined, 'c1'],
      ['where', 'type', '==', undefined, 'workout'],
      ['where', 'workout.date', '>', undefined, 1000],
      ['orderBy', 'workout.date', undefined, 'asc', undefined],
      ['limit', undefined, undefined, undefined, 20],
    ]
  )
})

test('upcoming workouts respects an explicit smaller query limit', async () => {
  const docs = Array.from({ length: 5 }, (_, index) => ({
    id: `s${index}`,
    communityId: 'c1',
    type: 'workout',
    workout: { date: 2000 + index },
  }))
  const { api } = await service(docs)
  const result = await api.listUpcomingWorkouts('c1', 2)
  assert.deepEqual(
    result.map((status) => status.id),
    ['s0', 's1']
  )
})

test('shared workout lookup resolves an event outside the query limit only in its own community', async () => {
  const docs = [
    { id: 'shared', communityId: 'c1', type: 'workout', workout: { date: 9000 } },
    { id: 'text', communityId: 'c1', type: 'text' },
  ]
  const { api } = await service(docs)
  assert.equal((await api.getSharedWorkout('shared', 'c1')).id, 'shared')
  assert.equal(await api.getSharedWorkout('shared', 'c2'), null)
  assert.equal(await api.getSharedWorkout('text', 'c1'), null)
  assert.equal(await api.getSharedWorkout('missing', 'c1'), null)
})
