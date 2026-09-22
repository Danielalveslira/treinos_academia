import { formatTime } from './format.js'

// Estado temporal do "treino marcado" (Treino Marcado V1) -- puro, calculado 100%
// client-side a partir de workout.date (nunca de expiresAt, que não tem relação
// nenhuma com o evento em si, ver firestore.rules canJoinWorkout). Nenhum
// scheduler/Function roda para manter isto atualizado: o card simplesmente recalcula a
// cada render, igual a qualquer outro relógio de UI do projeto (ver "now" compartilhado
// em useCommunityFeed.js).
const MINUTES_MS = 60000
const HOURS_MS = 60 * MINUTES_MS
const DAYS_MS = 24 * HOURS_MS
// Duração ESTIMADA do evento para decidir "em andamento" vs. "concluído" -- o schema
// não registra duração, check-in nem presença real. As 2h servem exclusivamente para
// apresentação e calendário; nunca confirmam que o treino começou ou aconteceu.
const ASSUMED_DURATION_MS = 2 * HOURS_MS
// Abaixo disso mostra minutos ("Começa em 15 min"); entre isto e 6h mostra horas
// arredondadas ("Começa em 2h"); acima disso cai para dia/data.
const SOON_MINUTES_THRESHOLD_MS = HOURS_MS
const SOON_HOURS_THRESHOLD_MS = 6 * HOURS_MS

function startOfDay(ms) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

// { key, label }: key é estável (para estilizar/testar sem depender do texto exato),
// label é exatamente o texto a exibir.
export function describeScheduledWorkoutState(dateMs, nowMs = Date.now()) {
  if (nowMs >= dateMs + ASSUMED_DURATION_MS) return { key: 'concluded', label: 'Concluído' }
  if (nowMs >= dateMs) return { key: 'ongoing', label: 'Em andamento' }

  const diff = dateMs - nowMs
  if (diff <= SOON_MINUTES_THRESHOLD_MS) {
    const minutes = Math.max(1, Math.round(diff / MINUTES_MS))
    return { key: 'soon', label: `Começa em ${minutes} min` }
  }
  if (diff <= SOON_HOURS_THRESHOLD_MS) {
    const hours = Math.max(1, Math.round(diff / HOURS_MS))
    return { key: 'soon', label: `Começa em ${hours}h` }
  }

  const dayDiff = Math.round((startOfDay(dateMs) - startOfDay(nowMs)) / DAYS_MS)
  if (dayDiff <= 0) return { key: 'today', label: `Hoje · ${formatTime(new Date(dateMs))}` }
  if (dayDiff === 1) return { key: 'upcoming', label: 'Amanhã' }
  return { key: 'upcoming', label: `Em ${dayDiff} dias` }
}

// Espelha exatamente a condição de canJoinWorkout em firestore.rules
// (status.workout.date > request.time) -- checagem client-side só para UX (desabilitar
// o botão sem esperar o servidor rejeitar); o servidor continua sendo quem decide de
// verdade.
export function isScheduledWorkoutJoinable(dateMs, nowMs = Date.now()) {
  return dateMs > nowMs
}

export function nextWorkoutParticipationState(count, participating) {
  const safeCount = Number.isInteger(count) && count >= 0 ? count : 0
  return {
    count: participating ? safeCount + 1 : Math.max(0, safeCount - 1),
    amParticipant: participating,
  }
}
