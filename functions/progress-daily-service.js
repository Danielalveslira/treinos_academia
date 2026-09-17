import { summarizeDailyWorkouts, workoutDateKey } from './progress-daily-core.js'

function dayBounds(dateKey, Timestamp) {
  const start = new Date(`${dateKey}T00:00:00.000-03:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) }
}

export function createProgressDailyService({ db, Timestamp, FieldValue }) {
  return async function rebuildProgressDay(uid, dateKey) {
    if (!uid || !dateKey) return
    const { start, end } = dayBounds(dateKey, Timestamp)
    const userRef = db.doc(`users/${uid}`)
    const summaryRef = db.doc(`users/${uid}/progressDaily/${dateKey}`)
    const workoutsQuery = db
      .collection(`users/${uid}/workouts`)
      .where('date', '>=', start)
      .where('date', '<', end)
    await db.runTransaction(async (transaction) => {
      // Ler o resumo faz todas as recomputações do mesmo dia disputarem o mesmo
      // documento. Se outra execução gravar primeiro, o Firestore repete esta
      // transação e refaz a query com o estado atual, evitando que um snapshot antigo
      // sobrescreva um novo em creates/updates/deletes concorrentes.
      const [user] = await transaction.getAll(userRef, summaryRef)
      if (!user.exists || user.data()?.accountStatus === 'deleting') {
        transaction.delete(summaryRef)
        return
      }
      const snapshot = await transaction.get(workoutsQuery)
      if (snapshot.empty) {
        transaction.delete(summaryRef)
        return
      }
      const workouts = snapshot.docs.map((item) => item.data())
      transaction.set(summaryRef, {
        dateKey,
        ...summarizeDailyWorkouts(workouts),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
  }
}

export function affectedWorkoutDays(before, after) {
  return [...new Set([workoutDateKey(before), workoutDateKey(after)].filter(Boolean))]
}
