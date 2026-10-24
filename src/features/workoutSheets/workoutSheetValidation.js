import { MAX_DURATION_MINUTES, MAX_DISTANCE_KM } from '../../utils/cardioSessions.js'
import { MAX_WORKOUT_SETS } from '../../utils/workoutSets.js'
export const SHEET_LIMITS = {
  active: 40,
  items: 40,
  sets: MAX_WORKOUT_SETS,
  duration: MAX_DURATION_MINUTES,
  distance: MAX_DISTANCE_KM,
}
export const SHEET_GOALS = {
  hipertrofia: 'Hipertrofia',
  forca: 'Força',
  resistencia: 'Resistência',
  condicionamento: 'Condicionamento',
  mobilidade: 'Mobilidade',
  other: 'Outro',
}
export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const EMPTY_SHEET = { name: '', goal: '', goal_description: '', weekdays: [], items: [] }
const numericFields = [
  'target_sets',
  'reps_min',
  'reps_max',
  'rest_seconds',
  'target_duration_minutes',
  'target_distance_km',
]
export function normalizeSheet(sheet) {
  return {
    name: String(sheet.name || '').trim(),
    goal: sheet.goal || null,
    goal_description: String(sheet.goal_description || '').trim(),
    weekdays: [...(sheet.weekdays || [])].sort((a, b) => a - b),
    items: (sheet.items || []).map((item) => ({
      exercise_id: item.exercise_id,
      ...Object.fromEntries(
        numericFields.map((key) => [
          key,
          item[key] === '' || item[key] == null ? null : Number(item[key]),
        ])
      ),
      note: String(item.note || '').trim(),
    })),
  }
}
export const sheetFingerprint = (sheet) => JSON.stringify(normalizeSheet(sheet))
export function validateSheet(sheet) {
  const value = normalizeSheet(sheet)
  if (!value.name || value.name.length > 80) return 'Informe um nome de 1 a 80 caracteres.'
  if (value.goal && !SHEET_GOALS[value.goal]) return 'Objetivo inválido.'
  if (value.goal_description.length > 500) return 'A descrição deve ter até 500 caracteres.'
  if (
    new Set(value.weekdays).size !== value.weekdays.length ||
    value.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    return 'Dias inválidos.'
  if (value.items.length > SHEET_LIMITS.items) return 'Use até 40 exercícios por ficha.'
  if (new Set(value.items.map((item) => item.exercise_id)).size !== value.items.length)
    return 'Exercício repetido na ficha.'
  for (const item of value.items) {
    for (const [key, min, max] of [
      ['target_sets', 1, SHEET_LIMITS.sets],
      ['reps_min', 1, 1000],
      ['reps_max', 1, 1000],
      ['rest_seconds', 0, 900],
      ['target_duration_minutes', 1, SHEET_LIMITS.duration],
      ['target_distance_km', 0.001, SHEET_LIMITS.distance],
    ]) {
      const n = item[key]
      if (
        n != null &&
        (!Number.isFinite(n) ||
          n < min ||
          n > max ||
          (key !== 'target_distance_km' && !Number.isInteger(n)))
      )
        return 'Revise as metas: valor fora do intervalo permitido.'
    }
    if (item.reps_min != null && item.reps_max != null && item.reps_min > item.reps_max)
      return 'Repetições mínimas devem ser menores ou iguais às máximas.'
    if (item.note.length > 300) return 'A observação deve ter até 300 caracteres.'
  }
  return null
}
export function sheetScopeExercises(exercises, scope) {
  if (!scope) return exercises
  const byId = new Map(exercises.map((e) => [e.id, e]))
  return scope.items
    .filter((i) => i.available !== false && byId.has(i.exercise_id))
    .map((i) => byId.get(i.exercise_id))
}
export function prescription(item) {
  if (!item) return ''
  return [
    item.target_sets && `${item.target_sets} séries`,
    (item.reps_min || item.reps_max) &&
      `${item.reps_min || '…'}–${item.reps_max || '…'} repetições`,
    item.rest_seconds != null && `${item.rest_seconds}s de descanso`,
    item.target_duration_minutes && `${item.target_duration_minutes} min`,
    item.target_distance_km && `${item.target_distance_km} km`,
    item.note,
  ]
    .filter(Boolean)
    .join(' · ')
}
