import { MAX_DURATION_MINUTES, MAX_DISTANCE_KM } from '../../utils/cardioSessions.js'
import { MAX_WORKOUT_SETS } from '../../utils/workoutSets.js'
import {
  configuredRestSeconds,
  formatRestDuration,
  resolveRestSeconds,
} from '../../utils/restTimer.js'
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
export function incompatibleTargetFields(item) {
  if (item.exercise?.type === 'cardio')
    return ['target_sets', 'reps_min', 'reps_max'].filter(
      (key) => item[key] !== '' && item[key] != null
    )
  return ['target_duration_minutes', 'target_distance_km'].filter(
    (key) => item[key] !== '' && item[key] != null
  )
}
// Nome do campo para a mensagem de erro e para WorkoutSheetItemEditor saber qual meta abrir/focar.
const FIELD_LABELS = {
  target_sets: 'séries-alvo',
  reps_min: 'repetições mínimas',
  reps_max: 'repetições máximas',
  rest_seconds: 'descanso',
  target_duration_minutes: 'duração',
  target_distance_km: 'distância',
  note: 'observação',
}
// Estrutura do erro (5.3, auditoria 2026-11-10): antes devolvia uma string genérica ("valor fora
// do intervalo permitido") sem dizer qual exercício nem qual campo -- o editor não tinha como
// abrir a meta certa nem focar o campo. Agora devolve { message, exerciseId, field } (ou null se
// válido); exerciseId/field ficam de fora para erros que não são de um exercício específico
// (nome, objetivo, dias, duplicidade, limite de itens).
export function validateSheet(sheet) {
  const value = normalizeSheet(sheet)
  if (!value.name || value.name.length > 80)
    return { message: 'Informe um nome de 1 a 80 caracteres.' }
  if (value.goal && !SHEET_GOALS[value.goal]) return { message: 'Objetivo inválido.' }
  if (value.goal_description.length > 500)
    return { message: 'A descrição deve ter até 500 caracteres.' }
  if (
    new Set(value.weekdays).size !== value.weekdays.length ||
    value.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    return { message: 'Dias inválidos.' }
  if (value.items.length > SHEET_LIMITS.items)
    return { message: 'Use até 40 exercícios por ficha.' }
  if (new Set(value.items.map((item) => item.exercise_id)).size !== value.items.length)
    return { message: 'Exercício repetido na ficha.' }
  for (const [index, item] of value.items.entries()) {
    const name = sheet.items[index]?.exercise?.name || `exercício ${index + 1}`
    const incompatible = incompatibleTargetFields(sheet.items[index])
    if (incompatible.length)
      return {
        message: `A categoria de ${name} foi atualizada. Remova as metas incompatíveis antes de salvar.`,
        exerciseId: item.exercise_id,
        field: incompatible[0],
      }
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
        return {
          message: `Revise "${FIELD_LABELS[key]}" em ${name}: valor fora do intervalo permitido.`,
          exerciseId: item.exercise_id,
          field: key,
        }
    }
    if (item.reps_min != null && item.reps_max != null && item.reps_min > item.reps_max)
      return {
        message: `Em ${name}, repetições mínimas devem ser menores ou iguais às máximas.`,
        exerciseId: item.exercise_id,
        field: 'reps_min',
      }
    if (item.note.length > 300)
      return {
        message: `A observação de ${name} deve ter até 300 caracteres.`,
        exerciseId: item.exercise_id,
        field: 'note',
      }
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
// Descanso no resumo da meta. Com `defaultRestSeconds` informado (mesmo null), o exercício que herda o
// padrão mostra o valor efetivo; sem a opção, só o tempo próprio do exercício aparece (como antes).
function restLabel(item, options) {
  const own = configuredRestSeconds(item.rest_seconds)
  if (own !== null) return own === 0 ? 'sem descanso' : `${formatRestDuration(own)} de descanso`
  if (!Object.hasOwn(options, 'defaultRestSeconds')) return null
  const effective = resolveRestSeconds(null, options.defaultRestSeconds)
  return effective === 0
    ? 'sem descanso (seu padrão)'
    : `${formatRestDuration(effective)} de descanso (seu padrão)`
}
// Só os dados estruturados (séries/reps/descanso/duração/distância), sem a observação
// pessoal — usada onde a nota precisa aparecer separada do resumo (ver WorkoutForm.jsx).
export function prescriptionSummary(item, options = {}) {
  if (!item) return ''
  return [
    item.target_sets && `${item.target_sets} séries`,
    (item.reps_min || item.reps_max) &&
      `${item.reps_min || '…'}–${item.reps_max || '…'} repetições`,
    restLabel(item, options),
    item.target_duration_minutes && `${item.target_duration_minutes} min`,
    item.target_distance_km && `${item.target_distance_km} km`,
  ]
    .filter(Boolean)
    .join(' · ')
}
export function prescription(item, options = {}) {
  if (!item) return ''
  return [prescriptionSummary(item, options), item.note].filter(Boolean).join(' · ')
}
