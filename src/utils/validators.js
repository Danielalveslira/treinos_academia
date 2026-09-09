const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/

export function validateUsername(rawUsername) {
  const errors = {}
  const username = (rawUsername || '').trim().toLowerCase()
  if (!username) errors.username = 'Escolha um nome de usuário'
  else if (!USERNAME_PATTERN.test(username)) {
    errors.username = 'Use de 3 a 20 letras minúsculas, números ou _ (sem espaços ou acentos)'
  }
  return errors
}

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
  else if (date > new Date().toISOString().slice(0, 10)) {
    errors.date = 'A data não pode ser no futuro'
  }
  return errors
}

export function hasErrors(errors) {
  return Object.keys(errors).length > 0
}

export function validateCommunity({ name, description }) {
  const errors = {}
  if (!name || !name.trim()) errors.name = 'Nome é obrigatório'
  else if (name.trim().length > 60) errors.name = 'Nome muito longo'
  if (description && description.trim().length > 300) errors.description = 'Descrição muito longa'
  return errors
}

export function validateTextStatus({ text }) {
  const errors = {}
  if (!text || !text.trim()) errors.text = 'Escreva algo para publicar'
  else if (text.trim().length > 500) errors.text = 'Texto muito longo'
  return errors
}

export function validatePollStatus({ question, options }) {
  const errors = {}
  if (!question || !question.trim()) errors.question = 'Pergunta é obrigatória'
  const filled = options.filter((o) => o.trim())
  if (filled.length < 2) errors.options = 'Adicione pelo menos 2 opções'
  return errors
}

export function validateWorkoutStatus({ title, date, location }) {
  const errors = {}
  if (!title || !title.trim()) errors.title = 'Título é obrigatório'
  if (!date) errors.date = 'Data é obrigatória'
  if (!location || !location.trim()) errors.location = 'Local é obrigatório'
  return errors
}
