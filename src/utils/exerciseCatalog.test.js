import test from 'node:test'
import assert from 'node:assert/strict'
import { MUSCLE_GROUPS } from '../constants/muscleGroups.js'
import { EXERCISE_TYPES } from './exerciseType.js'
import {
  getExerciseSource,
  isProviderExerciseAdded,
  mapCatalogCategoryToExerciseType,
  mapCatalogMuscleToPersonalGroup,
  providerExerciseToPersonal,
} from './exerciseCatalog.js'

// Amostra no formato de resposta do nosso catálogo (ver exerciseCatalogService.js): id é
// o UUID interno da linha em exercise_catalog, providerExerciseId é o ID original do
// dataset (imports/exercicios_ptbr.json) -- os dois nunca são o mesmo campo.
const sample = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    providerExerciseId: 'Hip_Thrust',
    name: 'Elevação de Quadril',
    primaryMuscles: ['gluteos'],
    secondaryMuscles: ['isquiotibiais'],
    equipment: 'barbell',
    category: 'forca',
    level: 'iniciante',
    instructions: ['Faça o movimento.'],
    images: ['Hip_Thrust/0.jpg'],
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    providerExerciseId: 'Running',
    name: 'Corrida',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: [],
    equipment: null,
    category: 'cardio',
    level: 'intermediario',
    instructions: [],
    images: [],
  },
]

test('muscle/category mapping cobre chaves legadas (free-exercise-db em inglês) e o dataset atual (pt-BR)', () => {
  assert.equal(mapCatalogMuscleToPersonalGroup({ primaryMuscles: ['glutes'] }), 'Glúteos')
  assert.equal(mapCatalogMuscleToPersonalGroup({ primaryMuscles: ['gluteos'] }), 'Glúteos')
  assert.equal(mapCatalogMuscleToPersonalGroup({ primaryMuscles: [] }), 'Pernas')
  assert.equal(mapCatalogCategoryToExerciseType('cardio'), 'cardio')
  assert.equal(mapCatalogCategoryToExerciseType('forca'), 'strength')
  assert.equal(mapCatalogCategoryToExerciseType('alongamento'), 'strength')
})

test('all mapped values stay within the app own muscle group / exercise type sets', () => {
  for (const exercise of sample) {
    assert.ok(MUSCLE_GROUPS.includes(mapCatalogMuscleToPersonalGroup(exercise)))
    assert.ok(EXERCISE_TYPES.includes(mapCatalogCategoryToExerciseType(exercise.category)))
  }
})

test('providerExerciseToPersonal keeps only the minimal snapshot (name/muscleGroup/equipment)', () => {
  const personal = providerExerciseToPersonal(sample[0], { order: 3 })
  assert.deepEqual(personal, {
    name: 'Elevação de Quadril',
    muscleGroup: 'Glúteos',
    type: 'strength',
    equipment: 'barbell',
    source: 'catalog',
    provider: 'evolutus_dataset',
    providerExerciseId: 'Hip_Thrust',
    catalogId: '11111111-1111-1111-1111-111111111111',
    active: true,
    note: '',
    order: 3,
  })
  // Conteúdo rico do catálogo NUNCA entra no snapshot -- fica só em
  // public.exercise_catalog, buscado sob demanda, nunca persistido em public.exercises.
  for (const richField of ['instructions', 'secondaryMuscles', 'level', 'images', 'category']) {
    assert.equal(Object.hasOwn(personal, richField), false)
  }
})

test('providerExerciseToPersonal keeps equipment null when the exercise has none', () => {
  const personal = providerExerciseToPersonal(sample[1])
  assert.equal(personal.equipment, null)
})

test('duplicate detection uses provider + providerExerciseId, not name', () => {
  const personal = [
    { id: 'legacy', name: 'Mesmo nome' },
    { id: 'custom', name: 'Mesmo nome', source: 'custom', providerExerciseId: null },
    { id: 'catalog', name: 'Outro nome', source: 'catalog', providerExerciseId: 'Hip_Thrust' },
  ]
  assert.equal(isProviderExerciseAdded(personal, 'Hip_Thrust'), true)
  assert.equal(isProviderExerciseAdded(personal, 'Running'), false)
  assert.equal(getExerciseSource(personal[0]), 'custom')
  assert.equal(getExerciseSource(personal[1]), 'custom')
  assert.equal(getExerciseSource(personal[2]), 'catalog')
})
