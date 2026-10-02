import { buildActivityDays, calculateConsistency } from './activityCalendar.js'
import { buildWeeklyPlanDays } from './trainingPlan.js'

// ÚNICO lugar que monta "dias de atividade do ano" + "consistência" a partir de progressDays e do
// planejamento de treino. Usado pela Home (card de consistência/calendário) e pelo compartilhamento de
// progresso nas Comunidades -- antes esse cálculo vivia só dentro de Dashboard.jsx.
//
// `current` (sequência atual) é calculada numa linha do tempo que começa em 1º/dez do ano anterior, para que
// a sequência não "zere" na virada do ano; o restante (melhor sequência, total) é do ano corrente.
export function buildConsistencySnapshot(progressDays, trainingPreferences, now = new Date()) {
  const plannedDays = buildWeeklyPlanDays(trainingPreferences, { now })
  const activityDays = buildActivityDays(progressDays, { now, plannedDays })
  const timelineStart = new Date(now.getFullYear() - 1, 11, 1, 12)
  const timeline = buildActivityDays(progressDays, {
    now,
    plannedDays: buildWeeklyPlanDays(trainingPreferences, { now, startDate: timelineStart }),
    startDate: timelineStart,
  })
  const annual = calculateConsistency(activityDays, now)
  return {
    activityDays,
    consistency: { ...annual, current: calculateConsistency(timeline, now).current },
  }
}
