export function validateExercise({ name, muscleGroup }) {
  const errors = {}
  if (!name || !name.trim()) errors.name = 'Nome é obrigatório'
  else if (name.trim().length > 60) errors.name = 'Nome muito longo'
  if (!muscleGroup) errors.muscleGroup = 'Grupo muscular é obrigatório'
  return errors
}

export function validateWorkout({ exerciseId, weight, sets, reps, date }) {
  const errors = {}
  if (!exerciseId) errors.exerciseId = 'Selecione um exercício'
  if (weight === '' || weight === null || Number(weight) < 0) {
    errors.weight = 'Peso inválido'
  }
  if (!sets || Number(sets) <= 0 || !Number.isInteger(Number(sets))) {
    errors.sets = 'Número de séries inválido'
  }
  if (!reps || Number(reps) <= 0 || !Number.isInteger(Number(reps))) {
    errors.reps = 'Número de repetições inválido'
  }
  if (!date) errors.date = 'Data é obrigatória'
  return errors
}

export function hasErrors(errors) {
  return Object.keys(errors).length > 0
}
