// Old custom exercises remain readable; only official, available items can start new sessions.
export const isLegacyExercise = (exercise) => exercise?.source !== 'catalog'
export const canStartExercise = (exercise) =>
  Boolean(
    exercise?.active &&
    exercise.source === 'catalog' &&
    ['evolutus_dataset', 'evolutus_original'].includes(exercise.provider) &&
    exercise.catalogAvailable !== false
  )
