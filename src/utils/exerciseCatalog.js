import { MUSCLE_GROUPS } from '../constants/muscleGroups.js'
import { EXERCISE_TYPES } from './exerciseType.js'

// Busca/filtro/ordenação sobre um array carregado do catálogo inteiro saíram daqui -- a
// busca é server-side, direto em public.exercise_catalog (ver
// exerciseCatalogService.searchExercises), nunca um array completo em memória.

// Mapa explícito dos 17 valores distintos de primary_muscle hoje em public.exercise_catalog
// (auditado direto em produção em 2026-09-30) + os equivalentes em inglês do dataset
// ExerciseAPI legado (ainda podem existir em exercícios pessoais adicionados naquela
// janela). Cobertura total testada em exerciseCatalog.test.js -- nenhum valor real cai no
// fallback silenciosamente.
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

const FALLBACK_MUSCLE_GROUP = 'Pernas'

// Fonte única da origem (primary_muscle estruturado) pro grupo oficial da biblioteca --
// nunca heurística sobre o nome do exercício. Um músculo fora do mapa é um dado novo do
// catálogo que ninguém revisou ainda: cai num fallback explícito, nunca silencioso --
// loga em dev pra ser notado e adicionado ao mapa, em vez de classificar errado sem
// ninguém perceber.
export function mapCatalogMuscleToLibraryGroup(primaryMuscle) {
  const key = primaryMuscle?.toLowerCase()
  const group = key ? MUSCLE_GROUP_MAP[key] : undefined
  if (group && MUSCLE_GROUPS.includes(group)) return group
  if (import.meta.env?.DEV) {
    console.warn(
      `[exerciseCatalog] músculo principal sem mapeamento: "${primaryMuscle}" -- caindo em "${FALLBACK_MUSCLE_GROUP}". Adicione-o a MUSCLE_GROUP_MAP.`
    )
  }
  return FALLBACK_MUSCLE_GROUP
}

// Mantido pelo shape usado em providerExerciseToPersonal (exercício vindo da busca do
// catálogo, com primaryMuscles: string[]) -- delega pro mapeamento central acima.
export function mapCatalogMuscleToPersonalGroup(exercise) {
  return mapCatalogMuscleToLibraryGroup(exercise?.primaryMuscles?.[0])
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

// Valores crus do dataset (slugs) que perderam acento na origem e não têm como ser
// recuperados algoritmicamente (ex.: "forca" não dá pra saber que vira "Força" só
// capitalizando) -- auditados direto em produção em 2026-09-30 contra os 17
// primary_muscle/12 equipment/7 category/3 difficulty reais. Achado durante o smoke
// test manual (ExerciseCatalog.jsx/WorkoutExerciseGuide.jsx/Exercises.jsx tinham cada
// um sua própria versão incompleta desse formatador).
const CATALOG_LABEL_OVERRIDES = {
  antebracos: 'Antebraços',
  gluteos: 'Glúteos',
  pescoco: 'Pescoço',
  quadriceps: 'Quadríceps',
  trapezio: 'Trapézio',
  triceps: 'Tríceps',
  biceps: 'Bíceps',
  maquina: 'Máquina',
  'bola-de-exercicio': 'Bola de Exercício',
  forca: 'Força',
  'levantamento-olimpico': 'Levantamento Olímpico',
  avancado: 'Avançado',
  intermediario: 'Intermediário',
}

// Preposições/artigos que não devem ficar maiúsculos no meio do rótulo (ex.:
// "inferior-das-costas" -> "Inferior das Costas", não "Inferior Das Costas").
const LOWERCASE_CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

// Único formatador de valor cru do catálogo (músculo/equipamento/categoria/dificuldade)
// pra exibição -- usado por ExerciseCatalog.jsx, WorkoutExerciseGuide.jsx e
// Exercises.jsx, no lugar de cada um ter sua própria versão duplicada/incompleta.
export function formatCatalogLabel(value) {
  if (value == null) return 'Não informado'
  const key = value.toLowerCase()
  if (Object.hasOwn(CATALOG_LABEL_OVERRIDES, key)) return CATALOG_LABEL_OVERRIDES[key]
  return value
    .replaceAll('-', ' ')
    .split(' ')
    .map((word, index) => {
      const lower = word.toLocaleLowerCase('pt-BR')
      if (index > 0 && LOWERCASE_CONNECTORS.has(lower)) return lower
      return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1)
    })
    .join(' ')
}
