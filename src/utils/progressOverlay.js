// Home offline: o snapshot de atividade (list_progress_days) é uma fotografia do momento em que foi gravado.
// O que o usuário registrou DEPOIS, no aparelho, vive nos treinos locais (cache do histórico + outbox). Sem
// juntar os dois, o treino feito offline não contaria na constância, no volume semanal nem na saudação até
// o servidor voltar. Funções puras (sem I/O).

const dayKeyOf = (workout) => String(workout?.date || '').slice(0, 10)

// Mesma agregação por dia de public.list_progress_days, só com os campos que a Home lê: contagem de
// treinos, volume de força (soma peso × repetições das séries) e os exercícios do dia.
export function summarizeWorkoutDays(workouts) {
  const byDay = new Map()
  for (const workout of workouts) {
    const dateKey = dayKeyOf(workout)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue
    const day = byDay.get(dateKey) ?? {
      dateKey,
      workoutCount: 0,
      strengthVolumeKg: 0,
      exerciseStats: [],
    }
    day.workoutCount += 1
    if (workout.type === 'strength') {
      for (const set of workout.setDetails || [])
        day.strengthVolumeKg += (Number(set.weight) || 0) * (Number(set.reps) || 0)
    }
    if (workout.exerciseId && !day.exerciseStats.some((s) => s.exerciseId === workout.exerciseId))
      day.exerciseStats.push({ exerciseId: workout.exerciseId })
    byDay.set(dateKey, day)
  }
  return byDay
}

// Substitui, no snapshot, os dias a partir de `sinceDayKey` (o dia em que ele foi gravado) pelos calculados
// dos treinos locais. `afterDayKey`: quando a leitura local foi cortada por limite (página cheia), o dia mais
// antigo dela pode estar incompleto -- só os dias estritamente DEPOIS dele são sobrescritos. Dias anteriores
// ficam como o servidor informou.
export function overlayLocalProgressDays(days, workouts, { sinceDayKey, afterDayKey = null }) {
  if (!Array.isArray(days) || !sinceDayKey) return days
  const covered = (dateKey) => dateKey >= sinceDayKey && (afterDayKey == null || dateKey > afterDayKey)
  const local = [...summarizeWorkoutDays(workouts).values()].filter((day) => covered(day.dateKey))
  const kept = days.filter((day) => !covered(day.dateKey))
  return [...kept, ...local].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0))
}
