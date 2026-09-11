export const EXERCISE_TYPES = ['strength', 'cardio']

export const EXERCISE_TYPE_LABELS = { strength: 'Força', cardio: 'Cardio' }

// Exercícios de antes deste campo existir não têm 'type' gravado — ausente sempre
// significa 'strength' (mesmo default usado em firestore.rules, isValidExercise).
export function getExerciseType(exercise) {
  return exercise?.type === 'cardio' ? 'cardio' : 'strength'
}

export function isCardioExercise(exercise) {
  return getExerciseType(exercise) === 'cardio'
}
