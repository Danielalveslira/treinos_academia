import test from 'node:test'
import assert from 'node:assert/strict'
import { MUSCLE_GROUPS } from '../constants/muscleGroups.js'
import { EXERCISE_TYPES } from './exerciseType.js'
import {
  formatCatalogLabel,
  getExerciseSource,
  isProviderExerciseAdded,
  mapCatalogCategoryToExerciseType,
  mapCatalogMuscleToLibraryGroup,
  mapCatalogMuscleToPersonalGroup,
  providerExerciseToPersonal,
} from './exerciseCatalog.js'

// Os 17 valores distintos de primary_muscle hoje em public.exercise_catalog, auditados
// direto em produção (868 exercícios) -- cada um DEVE ter um grupo oficial explícito,
// nenhum pode cair no fallback.
const REAL_PRIMARY_MUSCLES_TO_GROUP = {
  quadriceps: 'Pernas',
  ombros: 'Ombros',
  abdominais: 'Abdômen',
  peito: 'Peito',
  isquiotibiais: 'Pernas',
  triceps: 'Tríceps',
  biceps: 'Bíceps',
  dorsais: 'Costas',
  'meio-das-costas': 'Costas',
  panturrilhas: 'Panturrilha',
  'inferior-das-costas': 'Costas',
  antebracos: 'Bíceps',
  gluteos: 'Glúteos',
  trapezio: 'Costas',
  adutores: 'Pernas',
  pescoco: 'Costas',
  abdutores: 'Pernas',
}

test('mapCatalogMuscleToLibraryGroup cobre os 17 primary_muscle reais do catálogo, sem nenhum cair no fallback', () => {
  for (const [muscle, expectedGroup] of Object.entries(REAL_PRIMARY_MUSCLES_TO_GROUP)) {
    assert.equal(mapCatalogMuscleToLibraryGroup(muscle), expectedGroup, `músculo "${muscle}"`)
  }
})

test('mapCatalogMuscleToLibraryGroup tem um fallback explícito (nunca lança) pra músculo desconhecido', () => {
  assert.equal(mapCatalogMuscleToLibraryGroup('musculo-que-nao-existe'), 'Pernas')
  assert.equal(mapCatalogMuscleToLibraryGroup(undefined), 'Pernas')
  assert.equal(mapCatalogMuscleToLibraryGroup(null), 'Pernas')
})

// Achado no smoke test manual: valores crus do dataset perderam acento na origem
// ("forca", "quadriceps") e a preposição de nomes compostos ficava maiúscula
// ("Inferior Das Costas"). formatCatalogLabel é o único formatador -- usado em
// ExerciseCatalog.jsx, WorkoutExerciseGuide.jsx e Exercises.jsx.
test('formatCatalogLabel restaura o acento nos valores auditados que perderam diacrítico na origem', () => {
  assert.equal(formatCatalogLabel('forca'), 'Força')
  assert.equal(formatCatalogLabel('quadriceps'), 'Quadríceps')
  assert.equal(formatCatalogLabel('triceps'), 'Tríceps')
  assert.equal(formatCatalogLabel('biceps'), 'Bíceps')
  assert.equal(formatCatalogLabel('gluteos'), 'Glúteos')
  assert.equal(formatCatalogLabel('pescoco'), 'Pescoço')
  assert.equal(formatCatalogLabel('antebracos'), 'Antebraços')
  assert.equal(formatCatalogLabel('trapezio'), 'Trapézio')
  assert.equal(formatCatalogLabel('maquina'), 'Máquina')
  assert.equal(formatCatalogLabel('avancado'), 'Avançado')
  assert.equal(formatCatalogLabel('intermediario'), 'Intermediário')
  assert.equal(formatCatalogLabel('bola-de-exercicio'), 'Bola de Exercício')
  assert.equal(formatCatalogLabel('levantamento-olimpico'), 'Levantamento Olímpico')
})

test('formatCatalogLabel deixa preposições/artigos em minúsculo no meio do rótulo, nunca no início', () => {
  assert.equal(formatCatalogLabel('inferior-das-costas'), 'Inferior das Costas')
  assert.equal(formatCatalogLabel('meio-das-costas'), 'Meio das Costas')
  assert.equal(formatCatalogLabel('peso-do-corpo'), 'Peso do Corpo')
  assert.equal(formatCatalogLabel('rolo-de-espuma'), 'Rolo de Espuma')
})

test('formatCatalogLabel não mexe em valores que já ficam corretos só capitalizando', () => {
  assert.equal(formatCatalogLabel('barra'), 'Barra')
  assert.equal(formatCatalogLabel('kettlebell'), 'Kettlebell')
  assert.equal(formatCatalogLabel('iniciante'), 'Iniciante')
  assert.equal(formatCatalogLabel('cardio'), 'Cardio')
})

test('formatCatalogLabel nunca lança pra valor ausente', () => {
  assert.equal(formatCatalogLabel(null), 'Não informado')
  assert.equal(formatCatalogLabel(undefined), 'Não informado')
})

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
