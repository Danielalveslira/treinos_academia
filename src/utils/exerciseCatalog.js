import { MUSCLE_GROUPS } from '../constants/muscleGroups.js'
import { EXERCISE_TYPES } from './exerciseType.js'

const SEARCH_FIELDS = ['name', 'primaryMuscles', 'secondaryMuscles', 'equipment', 'category']

const MUSCLE_GROUP_MAP = {
  abdominais: 'Abdômen',
  abdutores: 'Pernas',
  adutores: 'Pernas',
  antebracos: 'Bíceps',
  biceps: 'Bíceps',
  dorsais: 'Costas',
  gluteos: 'Glúteos',
  'inferior-das-costas': 'Costas',
  isquiotibiais: 'Pernas',
  'meio-das-costas': 'Costas',
  ombros: 'Ombros',
  panturrilhas: 'Panturrilha',
  peito: 'Peito',
  pescoco: 'Costas',
  quadriceps: 'Pernas',
  trapezio: 'Costas',
  triceps: 'Tríceps',
}

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_/]+/g, ' ')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

export function searchCatalog(exercises, query) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return exercises
  return exercises.filter((exercise) => {
    const searchable = normalizeSearchText(
      SEARCH_FIELDS.flatMap((field) => exercise[field] ?? []).join(' ')
    )
    return terms.every((term) => searchable.includes(term))
  })
}

export function filterCatalog(exercises, filters = {}) {
  return exercises.filter((exercise) => {
    if (filters.muscle && !exercise.primaryMuscles.includes(filters.muscle)) return false
    if (filters.equipment !== undefined && exercise.equipment !== filters.equipment) return false
    if (filters.category && exercise.category !== filters.category) return false
    if (filters.level && exercise.level !== filters.level) return false
    return true
  })
}

export function sortCatalog(exercises) {
  return [...exercises].sort(
    (left, right) => left.name.localeCompare(right.name, 'pt-BR') || left.id.localeCompare(right.id)
  )
}

export function getCatalogExerciseById(exercises, id) {
  return exercises.find((exercise) => exercise.id === id) || null
}

export function getCatalogExerciseForPersonal(personalExercise, catalogExercises) {
  if (!personalExercise?.catalogExerciseId) return null
  return getCatalogExerciseById(catalogExercises, personalExercise.catalogExerciseId)
}

export function getWorkoutCatalogExercise(personalExercise, catalogExercises) {
  if (personalExercise?.source !== 'catalog') return null
  return getCatalogExerciseForPersonal(personalExercise, catalogExercises)
}

export function getCatalogFilterOptions(exercises, filters = {}) {
  const unique = (values) =>
    [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'))

  const without = (field) => ({ ...filters, [field]: undefined })
  const forMuscle = filterCatalog(exercises, without('muscle'))
  const forEquipment = filterCatalog(exercises, without('equipment'))
  const forCategory = filterCatalog(exercises, without('category'))
  const forLevel = filterCatalog(exercises, without('level'))

  return {
    muscles: unique(forMuscle.flatMap((exercise) => exercise.primaryMuscles)),
    equipment: unique(forEquipment.map((exercise) => exercise.equipment)),
    categories: unique(forCategory.map((exercise) => exercise.category)),
    levels: unique(forLevel.map((exercise) => exercise.level)),
  }
}

export function mapCatalogMuscleToPersonalGroup(exercise) {
  const group = MUSCLE_GROUP_MAP[exercise?.primaryMuscles?.[0]] || 'Pernas'
  return MUSCLE_GROUPS.includes(group) ? group : 'Pernas'
}

export function mapCatalogCategoryToExerciseType(category) {
  const type = category === 'cardio' ? 'cardio' : 'strength'
  return EXERCISE_TYPES.includes(type) ? type : 'strength'
}

export function catalogExerciseToPersonal(exercise, { order } = {}) {
  const personal = {
    name: exercise.name.trim(),
    muscleGroup: mapCatalogMuscleToPersonalGroup(exercise),
    type: mapCatalogCategoryToExerciseType(exercise.category),
    source: 'catalog',
    catalogExerciseId: exercise.id,
    active: true,
    note: '',
  }
  if (Number.isInteger(order) && order >= 0) personal.order = order
  return personal
}

export function isCatalogExerciseAdded(personalExercises, catalogExerciseId) {
  return personalExercises.some((exercise) => exercise.catalogExerciseId === catalogExerciseId)
}

export function getExerciseSource(exercise) {
  return exercise?.source === 'catalog' ? 'catalog' : 'custom'
}

export function getCatalogPersonalDocumentId(catalogExerciseId) {
  return `catalog--${encodeURIComponent(catalogExerciseId)}`
}
