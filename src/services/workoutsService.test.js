import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function service() {
  const { outputFiles } = await build({
    entryPoints: ['src/services/workoutsService.js'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'firestore-fixture',
        setup(build) {
          build.onResolve({ filter: /firebase\/firestore|firebase\/config$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }))
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: path.endsWith('config')
              ? 'export const db = {}'
              : `
          export const collection = (...args) => args
          export const doc = (...args) => args
          export const addDoc = async (ref, data) => ({ ref, data })
          export const updateDoc = addDoc
          export const deleteDoc = async (ref) => ref
          export const deleteField = () => 'DELETE_FIELD'
          export const query = (...args) => args
          export const orderBy = (...args) => args
          export const where = (...args) => args
          export const limit = (...args) => args
          export const startAfter = (...args) => args
          export const serverTimestamp = () => 'SERVER_TIMESTAMP'
          export const Timestamp = { fromDate: (date) => date }
          export const count = () => 'count'
          export const sum = (field) => field
          export const getAggregateFromServer = async () => ({ data: () => ({ entries: 1, sets: 3 }) })
          export const getDocs = async () => ({ docs: [{ id: 'legacy', data: () => ({ exerciseId: 'squat', weight: 30, sets: 3, reps: 12 }) }] })
        `,
          }))
        },
      },
    ],
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  )
}

// Firestore-fixture parametrizável: ao contrário de service() (que ignora a query e
// sempre devolve o mesmo documento canned), esta simula filtro/ordenação/cursor de
// verdade sobre um conjunto de documentos dado pelo teste — necessário para reproduzir
// a divisão de um mesmo dia entre duas páginas, que depende da ordem real (date desc,
// id desc) que o próprio Firestore usaria, não de createdAt.
async function serviceWithWorkouts(docs) {
  const seed = JSON.stringify(
    docs.map((d) => ({ ...d, date: d.date.toISOString(), createdAt: d.createdAt.toISOString() }))
  )
  const { outputFiles } = await build({
    entryPoints: ['src/services/workoutsService.js'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'firestore-fixture',
        setup(build) {
          build.onResolve({ filter: /firebase\/firestore|firebase\/config$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }))
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: path.endsWith('config')
              ? 'export const db = {}'
              : `
          const RAW = ${seed}
          const DOCS = RAW.map((d) => ({ ...d, date: new Date(d.date), createdAt: new Date(d.createdAt) }))
          // date desc, id desc — a mesma ordem (data + desempate por id do documento)
          // que o próprio Firestore usaria, sem nenhuma relação com createdAt.
          const ORDERED = [...DOCS].sort((a, b) => {
            const byDate = b.date.getTime() - a.date.getTime()
            if (byDate !== 0) return byDate
            return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
          })
          export const collection = (...args) => args
          export const doc = (...args) => args
          export const addDoc = async (ref, data) => ({ ref, data })
          export const updateDoc = addDoc
          export const deleteDoc = async (ref) => ref
          export const deleteField = () => 'DELETE_FIELD'
          export const orderBy = (field, dir) => ({ type: 'orderBy', field, dir })
          export const where = (field, op, value) => ({ type: 'where', field, op, value })
          export const limit = (n) => ({ type: 'limit', n })
          export const startAfter = (snap) => ({ type: 'startAfter', id: snap.id })
          export const query = (ref, ...constraints) => ({ constraints })
          export const serverTimestamp = () => 'SERVER_TIMESTAMP'
          export const Timestamp = { fromDate: (date) => date }
          export const count = () => 'count'
          export const sum = (field) => field
          export const getAggregateFromServer = async () => ({ data: () => ({ entries: 1, sets: 3 }) })
          export const getDocs = async (q) => {
            let result = ORDERED
            for (const c of q.constraints) {
              if (c.type !== 'where') continue
              result = result.filter((d) => {
                const val = d[c.field] instanceof Date ? d[c.field].getTime() : d[c.field]
                const target = c.value instanceof Date ? c.value.getTime() : c.value
                if (c.op === '==') return val === target
                if (c.op === '>=') return val >= target
                if (c.op === '<=') return val <= target
                return true
              })
            }
            const startAfterC = q.constraints.find((c) => c.type === 'startAfter')
            if (startAfterC) {
              const idx = result.findIndex((d) => d.id === startAfterC.id)
              result = idx === -1 ? [] : result.slice(idx + 1)
            }
            const limitC = q.constraints.find((c) => c.type === 'limit')
            if (limitC) result = result.slice(0, limitC.n)
            return { docs: result.map((d) => ({ id: d.id, data: () => d })) }
          }
        `,
          }))
        },
      },
    ],
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  )
}

test('a same-day boundary split across pages does not reorder more recent records after older ones', async () => {
  // Um dia só (2025-01-01) com 3 registros. Em ordem "date desc, id desc" (a ordem real
  // do banco, sem relação com a hora de criação): c, b, a. Com pageSize 2, a página
  // bruta corta em [c, b] e deixa "a" pra próxima página — mas "a" (createdAt 200) foi
  // criado DEPOIS de "c" (createdAt 100). Sem juntar o dia inteiro antes de reordenar,
  // "a" apareceria na paginação depois de "c", mesmo sendo mais recente.
  const day = new Date('2025-01-01T12:00:00')
  const workout = (id, createdAtMillis) => ({
    id,
    exerciseId: 'squat',
    weight: 10,
    sets: 1,
    reps: 1,
    date: day,
    createdAt: new Date(createdAtMillis),
  })
  const docs = [workout('c', 100), workout('b', 300), workout('a', 200)]
  const api = await serviceWithWorkouts(docs)
  const page = await api.listWorkoutsPage('owner', { pageSize: 2 })
  assert.deepEqual(
    page.items.map((w) => w.id),
    ['b', 'a', 'c']
  )
  // O cursor da próxima página precisa continuar depois do dia inteiro (o real último
  // documento, "a"), não do corte bruto original ("b") — senão "a" seria repetido.
  assert.equal(page.nextCursor.id, 'a')
})

test('create and edit persist ordered numeric sets and a derived aggregate count, stripping UI and legacy fields', async () => {
  const api = await service()
  const workout = {
    exerciseId: 'squat',
    date: '2025-01-01',
    note: ' test ',
    weight: 999,
    reps: 99,
    sets: 99,
    setDetails: [
      { key: 4, weight: '30.25', reps: '8' },
      { key: 2, weight: '0', reps: '12' },
    ],
  }
  const { data } = await api.createWorkout('owner', workout)
  assert.deepEqual(data.setDetails, [
    { weight: 30.25, reps: 8 },
    { weight: 0, reps: 12 },
  ])
  assert.equal(data.sets, 2)
  assert.equal(data.note, 'test')
  assert.ok(data.date instanceof Date)
  assert.equal(data.weight, undefined)
  assert.equal(data.reps, undefined)
  const edit = await api.updateWorkout('owner', 'existing', workout)
  assert.equal(edit.data.weight, 'DELETE_FIELD')
  assert.equal(edit.data.reps, 'DELETE_FIELD')
  assert.equal(edit.data.repetitions, 'DELETE_FIELD')
  assert.deepEqual(edit.data.setDetails, data.setDetails)
  for (const setDetails of [[], [{ weight: -1, reps: 8 }], [{ weight: NaN, reps: 8 }]]) {
    assert.throws(() => api.createWorkout('owner', { ...workout, setDetails }))
    assert.throws(() => api.updateWorkout('owner', 'existing', { ...workout, setDetails }))
  }
})

test('all workout read paths normalize legacy records while retaining snapshot cursors', async () => {
  const api = await service()
  const page = await api.listWorkoutsPage('owner', { pageSize: 1 })
  assert.equal(page.nextCursor.id, 'legacy')
  assert.equal(typeof page.nextCursor.data, 'function')
  const exercise = await api.listWorkoutsForExercise('owner', 'squat')
  const dashboard = await api.listDashboardWorkouts('owner')
  for (const record of [page.items[0], exercise[0], dashboard[0]]) {
    assert.equal(record.sets, 3)
    assert.deepEqual(record.setDetails, Array(3).fill({ weight: 30, reps: 12 }))
  }
})
