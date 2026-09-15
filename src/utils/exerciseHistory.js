import { toDate } from './date.js'

function sessionTime(session) {
  const date = session?.date ? toDate(session.date) : null
  return date && Number.isFinite(date.getTime()) ? date.getTime() : null
}

export function recentExerciseSessions(sessions, days = 7) {
  if (!Number.isInteger(days) || days < 1) return []
  const dated = sessions
    .map((session, index) => ({ session, index, time: sessionTime(session) }))
    .filter(({ time }) => time !== null)
    .sort((a, b) => b.time - a.time || a.index - b.index)
  if (!dated.length) return []

  const latest = new Date(dated[0].time)
  const latestDay = new Date(latest.getFullYear(), latest.getMonth(), latest.getDate()).getTime()
  const cutoffDate = new Date(latestDay)
  cutoffDate.setDate(cutoffDate.getDate() - (days - 1))
  const cutoff = cutoffDate.getTime()

  return dated
    .filter(({ time }) => {
      const date = new Date(time)
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      return day >= cutoff && day <= latestDay
    })
    .map(({ session }) => session)
}
