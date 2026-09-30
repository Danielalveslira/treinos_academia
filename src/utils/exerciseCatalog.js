import { MUSCLE_GROUPS } from '../constants/muscleGroups.js'
import { EXERCISE_TYPES } from './exerciseType.js'

// Busca/filtro/ordenação sobre um array carregado do catálogo inteiro saíram daqui -- a
// busca é server-side, direto em public.exercise_catalog (ver
// exerciseCatalogService.searchExercises), nunca um array completo em memória.

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
  chest: 'Peito',
  back: 'Costas',
  shoulders: 'Ombros',
  legs: 'Pernas',
  arms: 'Bíceps',
  core: 'Abdômen',
  glutes: 'Glúteos',
  calves: 'Panturrilha',
}

export function mapCatalogMuscleToPersonalGroup(exercise) {
  const group = MUSCLE_GROUP_MAP[exercise?.primaryMuscles?.[0]?.toLowerCase()] || 'Pernas'
  return MUSCLE_GROUPS.includes(group) ? group : 'Pernas'
}

export function mapCatalogCategoryToExerciseType(category) {
  const type = category === 'cardio' ? 'cardio' : 'strength'
  return EXERCISE_TYPES.includes(type) ? type : 'strength'
}

// Equivalente a catalogExerciseToPersonal -- snapshot mínimo no momento do "Adicionar":
// nome, grupo muscular e equipamento (os três campos que mantêm um treino antigo
// compreensível mesmo que o catálogo mude ou remova o exercício depois). NUNCA copia
// imagens/instruções -- conteúdo rico fica só em public.exercise_catalog, buscado sob
// demanda (ver docs/MIGRACAO_SUPABASE_STATUS.md). catalogId é o atalho opcional
// (exercises.catalog_id, ON DELETE SET NULL) -- nunca a chave primária em si.
export function providerExerciseToPersonal(exercise, { order } = {}) {
  const personal = {
    name: exercise.name.trim(),
    muscleGroup: mapCatalogMuscleToPersonalGroup(exercise),
    type: mapCatalogCategoryToExerciseType(exercise.category),
    equipment: exercise.equipment || null,
    source: 'catalog',
    provider: 'evolutus_dataset',
    providerExerciseId: exercise.providerExerciseId,
    catalogId: exercise.id,
    active: true,
    note: '',
  }
  if (Number.isInteger(order) && order >= 0) personal.order = order
  return personal
}

export function isProviderExerciseAdded(personalExercises, providerExerciseId) {
  return personalExercises.some((exercise) => exercise.providerExerciseId === providerExerciseId)
}

export function getExerciseSource(exercise) {
  return exercise?.source === 'catalog' ? 'catalog' : 'custom'
}
