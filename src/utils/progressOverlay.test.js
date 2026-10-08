import test from 'node:test'
import assert from 'node:assert/strict'
import { overlayLocalProgressDays, summarizeWorkoutDays } from './progressOverlay.js'

const strength = (id, date, exerciseId, sets) => ({
  id,
  exerciseId,
  type: 'strength',
  date: `${date}T12:00:00`,
  setDetails: sets,
})
const cardio = (id, date, exerciseId) => ({
  id,
  exerciseId,
  type: 'cardio',
  date: `${date}T12:00:00`,
  durationMinutes: 30,
  setDetails: [],
})
const day = (dateKey, workoutCount, strengthVolumeKg = 0, ids = []) => ({
  dateKey,
  workoutCount,
  strengthVolumeKg,
  exerciseStats: ids.map((exerciseId) => ({ exerciseId })),
})

test('resume o dia como public.list_progress_days: contagem, volume de força e exercícios do dia', () => {
  const days = summarizeWorkoutDays([
    strength('1', '2026-10-08', 'e1', [{ weight: 50, reps: 10 }, { weight: 60, reps: 8 }]),
    strength('2', '2026-10-08', 'e2', [{ weight: 20, reps: 12 }]),
    strength('3', '2026-10-08', 'e1', [{ weight: 10, reps: 10 }]),
    cardio('4', '2026-10-08', 'e3'),
    strength('5', '2026-10-07', 'e1', [{ weight: 100, reps: 1 }]),
  ])
  const today = days.get('2026-10-08')
  assert.equal(today.workoutCount, 4)
  assert.equal(today.strengthVolumeKg, 500 + 480 + 240 + 100) // cardio não soma volume
  assert.deepEqual(today.exerciseStats, [{ exerciseId: 'e1' }, { exerciseId: 'e2' }, { exerciseId: 'e3' }])
  assert.equal(days.get('2026-10-07').strengthVolumeKg, 100)
})

test('ignora registros sem data válida', () => {
  assert.equal(summarizeWorkoutDays([{ type: 'strength', date: 'ontem' }, {}]).size, 0)
})

test('treino registrado OFFLINE depois do snapshot passa a contar no dia (e nos seguintes)', () => {
  const snapshot = [day('2026-10-06', 1, 300, ['e1']), day('2026-10-07', 1, 200, ['e1'])]
  const local = [strength('n1', '2026-10-08', 'e2', [{ weight: 40, reps: 10 }])]
  const merged = overlayLocalProgressDays(snapshot, local, { sinceDayKey: '2026-10-07' })
  assert.deepEqual(merged.map((d) => d.dateKey), ['2026-10-06', '2026-10-08'])
  // O dia 07 (do dia do snapshot em diante) é recalculado dos treinos locais: não há nenhum => some.
  assert.equal(merged[1].workoutCount, 1)
  assert.equal(merged[1].strengthVolumeKg, 400)
})

test('dias anteriores ao snapshot ficam exatamente como o servidor informou', () => {
  const snapshot = [day('2026-09-01', 3, 900, ['e1']), day('2026-10-01', 1, 100, ['e2'])]
  const merged = overlayLocalProgressDays(snapshot, [], { sinceDayKey: '2026-10-08' })
  assert.deepEqual(merged, snapshot)
})

test('treino do dia do snapshot é recalculado dos locais (edição/exclusão offline refletem)', () => {
  const snapshot = [day('2026-10-08', 2, 800, ['e1', 'e2'])]
  const local = [strength('a', '2026-10-08', 'e1', [{ weight: 10, reps: 10 }])] // o outro foi apagado offline
  const merged = overlayLocalProgressDays(snapshot, local, { sinceDayKey: '2026-10-08' })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].workoutCount, 1)
  assert.equal(merged[0].strengthVolumeKg, 100)
})

test('leitura local cortada por limite: o dia mais antigo dela (possivelmente incompleto) não sobrescreve o servidor', () => {
  const snapshot = [day('2026-10-07', 5, 5000, ['e1'])]
  const local = [strength('x', '2026-10-07', 'e1', [{ weight: 1, reps: 1 }]), strength('y', '2026-10-08', 'e1', [{ weight: 2, reps: 2 }])]
  const merged = overlayLocalProgressDays(snapshot, local, { sinceDayKey: '2026-10-01', afterDayKey: '2026-10-07' })
  assert.deepEqual(merged.map((d) => [d.dateKey, d.workoutCount]), [['2026-10-07', 5], ['2026-10-08', 1]])
})

test('sem snapshot de dias (ou sem dia-base) devolve a entrada como veio', () => {
  assert.equal(overlayLocalProgressDays(null, [], { sinceDayKey: '2026-10-08' }), null)
  const days = [day('2026-10-08', 1)]
  assert.equal(overlayLocalProgressDays(days, [], {}), days)
})
