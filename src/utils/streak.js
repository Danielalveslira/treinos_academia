import { toDate } from './date.js'

// A partir daqui, "hoje" já passou da hora que consideramos "reta final" — mostra o
// aviso de urgência só quando o dia ainda não foi treinado.
const URGENT_HOUR = 18

// Sempre hora local do dispositivo (getFullYear/getMonth/getDate, nunca getUTC*) — é o
// que evita a sequência zerar errado perto da meia-noite em fusos diferentes de UTC.
function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Sequência de dias ativos consecutivos (estilo Duolingo) — puramente derivada do
// histórico de treinos já carregado (allWorkouts, mesma fonte do gráfico de
// consistência), sem nenhum campo agregado gravado à parte: nunca fica desatualizado, e
// criar um treino invalida o cache que alimenta esse cálculo (ver invalidateWorkoutCache
// em workoutsService.js), então a Home reflete a sequência nova sem precisar de um job.
export function getDailyStreak(workouts, now = new Date()) {
  const today = localDayKey(now)
  const days = new Set()

  for (const workout of workouts) {
    const date = toDate(workout.date)
    if (Number.isNaN(date.getTime())) continue
    const key = localDayKey(date)
    if (key > today) continue // treino "no futuro" (fuso/relógio local) não conta ainda
    days.add(key)
  }

  const trainedToday = days.has(today)

  // Ainda não treinou hoje não deve zerar a sequência de ontem antes da meia-noite —
  // o dia de hoje só "conta contra" a sequência quando ele efetivamente termina sem
  // treino (ver todayIsUrgent/o aviso na UI, que é o alerta desse risco).
  let current = 0
  const cursor = new Date(now)
  if (!trainedToday) cursor.setDate(cursor.getDate() - 1)
  while (days.has(localDayKey(cursor))) {
    current += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  let longest = 0
  let run = 0
  let previousDate = null
  for (const key of [...days].sort()) {
    const date = new Date(`${key}T00:00:00`)
    const diffDays = previousDate ? Math.round((date - previousDate) / 86400000) : null
    run = diffDays === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previousDate = date
  }

  const last7Days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now)
    date.setDate(date.getDate() - (6 - index))
    const key = localDayKey(date)
    return { date: key, trained: days.has(key), isToday: key === today }
  })

  return {
    current,
    longest,
    trainedToday,
    last7Days,
    todayIsUrgent: !trainedToday && now.getHours() >= URGENT_HOUR,
  }
}
