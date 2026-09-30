// Enums fixos do nosso próprio catálogo (imports/exercicios_ptbr.json, free-exercise-db
// traduzido) -- hardcoded de propósito: são um conjunto fechado e conhecido do nosso
// dataset, não um vocabulário livre de terceiro que possa mudar sem aviso.
export const EXERCISE_CATALOG_CATEGORIES = [
  'forca',
  'alongamento',
  'pliometria',
  'powerlifting',
  'levantamento-olimpico',
  'strongman',
  'cardio',
]

export const EXERCISE_CATALOG_LEVELS = ['iniciante', 'intermediario', 'avancado']
export const EXERCISE_CATALOG_FORCES = ['push', 'pull', 'static']
export const EXERCISE_CATALOG_MECHANICS = ['composto', 'isolado']
