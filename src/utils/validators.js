import { isValidSet, MAX_WORKOUT_SETS } from './workoutSets.js'
import { calculateAge } from './age.js'

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/
export const SEXO_OPTIONS = ['masculino', 'feminino', 'nao_informar']
const MAX_PLAUSIBLE_AGE = 120

// Mesmo padrão de validateWorkout abaixo (formato + volta por toISOString para
// rejeitar datas de calendário inexistentes, ex.: 2025-02-30) — replicado aqui em vez
// de reaproveitado porque as duas mensagens de erro e a regra de idade mínima são
// específicas de data de nascimento.
export function validateBirthDate(dateString, { minimumAge } = {}) {
  const errors = {}
  if (!dateString) {
    errors.birthDate = 'Data de nascimento é obrigatória'
  } else if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateString) ||
    !Number.isFinite(new Date(dateString).getTime()) ||
    new Date(dateString).toISOString().slice(0, 10) !== dateString
  ) {
    errors.birthDate = 'Data de nascimento inválida'
  } else if (dateString > new Date().toISOString().slice(0, 10)) {
    errors.birthDate = 'A data de nascimento não pode ser no futuro'
  } else if (calculateAge(dateString) > MAX_PLAUSIBLE_AGE) {
    errors.birthDate = 'Data de nascimento inválida'
  } else if (minimumAge != null && calculateAge(dateString) < minimumAge) {
    errors.birthDate = `É necessário ter pelo menos ${minimumAge} anos para se cadastrar`
  }
  return errors
}

export function validateSexo(value) {
  const errors = {}
  if (value != null && !SEXO_OPTIONS.includes(value)) errors.sexo = 'Opção inválida'
  return errors
}

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

export function validateWorkout({ exerciseId, setDetails, date, note }) {
  const errors = {}
  if (!exerciseId || typeof exerciseId !== 'string') errors.exerciseId = 'Selecione um exercício'
  if (!Array.isArray(setDetails) || setDetails.length < 1 || setDetails.length > MAX_WORKOUT_SETS) {
    errors.setDetails = `Informe de 1 a ${MAX_WORKOUT_SETS} séries válidas`
  } else {
    setDetails.forEach((set, index) => {
      if (!isValidSet(set))
        errors[`set${index}`] = 'Informe peso de 0 a 10.000 kg e repetições inteiras de 1 a 100.000'
    })
  }
  if (!date) errors.date = 'Data é obrigatória'
  else if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(new Date(date).getTime()) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    errors.date = 'Data inválida'
  } else if (date > new Date().toISOString().slice(0, 10)) {
    errors.date = 'A data não pode ser no futuro'
  }
  if (note != null && (typeof note !== 'string' || note.trim().length > 300))
    errors.note = 'Use até 300 caracteres'
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
  else if (question.trim().length > 200) errors.question = 'Pergunta muito longa'
  const filled = options.filter((o) => o.trim())
  if (filled.length < 2) errors.options = 'Adicione pelo menos 2 opções'
  else if (filled.some((o) => o.trim().length > 80)) errors.options = 'Uma das opções está muito longa'
  return errors
}

export function validateWorkoutStatus({ title, date, location }) {
  const errors = {}
  if (!title || !title.trim()) errors.title = 'Título é obrigatório'
  else if (title.trim().length > 100) errors.title = 'Título muito longo'
  if (!date) errors.date = 'Data é obrigatória'
  if (!location || !location.trim()) errors.location = 'Local é obrigatório'
  else if (location.trim().length > 150) errors.location = 'Local muito longo'
  return errors
}

export function validatePhotoStatus({ blob, caption }) {
  const errors = {}
  if (!blob) errors.photo = 'Escolha uma foto para publicar'
  if (caption && caption.trim().length > 280) errors.caption = 'Legenda muito longa'
  return errors
}
