// Período do dia pelo horário LOCAL do aparelho (sem geolocalização nem libs): dia = 06:00–17:59, noite = o resto.
export const DAY_STARTS_AT = 6
export const NIGHT_STARTS_AT = 18

export function getDayPeriod(now = new Date()) {
  const hour = now.getHours()
  return hour >= DAY_STARTS_AT && hour < NIGHT_STARTS_AT ? 'day' : 'night'
}

// Milissegundos até a próxima virada (06:00 ou 18:00), mais 1s de folga para cair já no período novo.
export function msUntilNextPeriod(now = new Date()) {
  const next = new Date(now)
  const hour = now.getHours()
  if (hour < DAY_STARTS_AT) next.setHours(DAY_STARTS_AT, 0, 0, 0)
  else if (hour < NIGHT_STARTS_AT) next.setHours(NIGHT_STARTS_AT, 0, 0, 0)
  else {
    next.setDate(next.getDate() + 1)
    next.setHours(DAY_STARTS_AT, 0, 0, 0)
  }
  return next.getTime() - now.getTime() + 1000
}
