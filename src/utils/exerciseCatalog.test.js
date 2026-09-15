import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'
import { MUSCLE_GROUPS } from '../constants/muscleGroups.js'
import { EXERCISE_TYPES } from './exerciseType.js'
import {
  catalogExerciseToPersonal,
  filterCatalog,
  getCatalogFilterOptions,
  getCatalogExerciseById,
  getCatalogExerciseForPersonal,
  getWorkoutCatalogExercise,
  getExerciseSource,
  isCatalogExerciseAdded,
  mapCatalogCategoryToExerciseType,
  mapCatalogMuscleToPersonalGroup,
  normalizeSearchText,
  searchCatalog,
  sortCatalog,
} from './exerciseCatalog.js'

const sample = [
  {
    id: 'one',
    name: 'Elevação de Quadril',
    primaryMuscles: ['gluteos'],
    secondaryMuscles: ['isquiotibiais'],
    equipment: 'peso-do-corpo',
    category: 'forca',
    level: 'iniciante',
    instructions: ['Faça o movimento.'],
    imageRefs: ['one/0.jpg'],
  },
  {
    id: 'two',
    name: 'Corrida',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: [],
    equipment: null,
    category: 'cardio',
    level: 'intermediario',
    instructions: [],
    imageRefs: [],
  },
]

test('generated catalog loads with 873 unique stable IDs', async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL('../../public/exercise-catalog/v1/catalog.json', import.meta.url),
      'utf8'
    )
  )
  assert.equal(catalog.version, 1)
  assert.equal(catalog.exercises.length, 873)
  assert.equal(new Set(catalog.exercises.map(({ id }) => id)).size, 873)
  assert.ok(getCatalogExerciseById(catalog.exercises, 'Barbell_Deadlift'))
})

test('catalog search covers name without accents, muscles, equipment and category', () => {
  assert.equal(normalizeSearchText('Elevação'), 'elevacao')
  assert.deepEqual(
    searchCatalog(sample, 'elevacao').map(({ id }) => id),
    ['one']
  )
  assert.deepEqual(
    searchCatalog(sample, 'isquiotibiais').map(({ id }) => id),
    ['one']
  )
  assert.deepEqual(
    searchCatalog(sample, 'peso corpo').map(({ id }) => id),
    ['one']
  )
  assert.deepEqual(
    searchCatalog(sample, 'cardio').map(({ id }) => id),
    ['two']
  )
})

test('catalog filters equipment, category, level and primary muscle, including null', () => {
  assert.deepEqual(
    filterCatalog(sample, { equipment: 'peso-do-corpo' }).map(({ id }) => id),
    ['one']
  )
  assert.deepEqual(
    filterCatalog(sample, { equipment: null }).map(({ id }) => id),
    ['two']
  )
  assert.deepEqual(
    filterCatalog(sample, { category: 'cardio' }).map(({ id }) => id),
    ['two']
  )
  assert.deepEqual(
    filterCatalog(sample, { level: 'iniciante' }).map(({ id }) => id),
    ['one']
  )
  assert.deepEqual(
    filterCatalog(sample, { muscle: 'quadriceps' }).map(({ id }) => id),
    ['two']
  )
})

test('catalog filter options only expose values compatible with the other active filters', () => {
  const options = getCatalogFilterOptions(sample, { muscle: 'gluteos' })
  assert.deepEqual(options.equipment, ['peso-do-corpo'])
  assert.deepEqual(options.categories, ['forca'])
  assert.deepEqual(options.levels, ['iniciante'])

  const cardioOptions = getCatalogFilterOptions(sample, {
    category: 'cardio',
    level: 'intermediario',
  })
  assert.deepEqual(cardioOptions.muscles, ['quadriceps'])
  assert.deepEqual(cardioOptions.equipment, [null])
})

test('catalog sorting uses name and stable ID as tie breaker', () => {
  const equalNames = [
    { ...sample[0], id: 'b', name: 'Mesmo nome' },
    { ...sample[1], id: 'a', name: 'Mesmo nome' },
  ]
  assert.deepEqual(
    sortCatalog(equalNames).map(({ id }) => id),
    ['a', 'b']
  )
})

test('all catalog muscles and categories map to current personal values', async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL('../../public/exercise-catalog/v1/catalog.json', import.meta.url),
      'utf8'
    )
  )
  for (const exercise of catalog.exercises) {
    assert.ok(MUSCLE_GROUPS.includes(mapCatalogMuscleToPersonalGroup(exercise)))
    assert.ok(EXERCISE_TYPES.includes(mapCatalogCategoryToExerciseType(exercise.category)))
  }
})

test('catalog maps only lightweight fields to a personal exercise', () => {
  const personal = catalogExerciseToPersonal(sample[0], { order: 3 })
  assert.deepEqual(personal, {
    name: 'Elevação de Quadril',
    muscleGroup: 'Glúteos',
    type: 'strength',
    source: 'catalog',
    catalogExerciseId: 'one',
    active: true,
    note: '',
    order: 3,
  })
  for (const heavyField of [
    'instructions',
    'secondaryMuscles',
    'equipment',
    'level',
    'imageRefs',
    'category',
  ]) {
    assert.equal(Object.hasOwn(personal, heavyField), false)
  }
})

test('duplicate detection uses catalog ID, not name; legacy and custom remain custom', () => {
  const personal = [
    { id: 'legacy', name: 'Mesmo nome' },
    { id: 'custom', name: 'Mesmo nome', source: 'custom', catalogExerciseId: null },
    { id: 'catalog', name: 'Outro nome', source: 'catalog', catalogExerciseId: 'one' },
  ]
  assert.equal(isCatalogExerciseAdded(personal, 'one'), true)
  assert.equal(isCatalogExerciseAdded(personal, 'two'), false)
  assert.equal(getExerciseSource(personal[0]), 'custom')
  assert.equal(getExerciseSource(personal[1]), 'custom')
})

test('personal catalog exercise resolves static catalog data through catalogExerciseId', () => {
  assert.equal(getCatalogExerciseForPersonal({ catalogExerciseId: 'two' }, sample)?.id, 'two')
  assert.equal(getCatalogExerciseForPersonal({ source: 'custom' }, sample), null)
})

test('workout resolves only explicit catalog exercises; custom, legacy and missing IDs stay visual-free', () => {
  assert.equal(
    getWorkoutCatalogExercise({ source: 'catalog', catalogExerciseId: 'one' }, sample)?.id,
    'one'
  )
  assert.equal(
    getWorkoutCatalogExercise({ source: 'custom', catalogExerciseId: 'one' }, sample),
    null
  )
  assert.equal(getWorkoutCatalogExercise({ catalogExerciseId: 'one' }, sample), null)
  assert.equal(
    getWorkoutCatalogExercise({ source: 'catalog', catalogExerciseId: 'missing' }, sample),
    null
  )
})
