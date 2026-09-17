import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createProgressDailyService } from '../functions/progress-daily-service.js'
import { parseBackfillArgs, runProgressDailyBackfill } from './progress-daily-backfill-core.mjs'

const { uid, apply } = parseBackfillArgs(process.argv.slice(2))

initializeApp({ credential: applicationDefault() })
const db = getFirestore()
const rebuildProgressDay = createProgressDailyService({ db, Timestamp, FieldValue })
await runProgressDailyBackfill({
  uid,
  apply,
  loadUser: async (userId) => (await db.doc(`users/${userId}`).get()).exists,
  loadWorkouts: async (userId) =>
    (await db.collection(`users/${userId}/workouts`).get()).docs.map((item) => item.data()),
  loadExistingDayIds: async (userId) =>
    (await db.collection(`users/${userId}/progressDaily`).get()).docs.map((item) => item.id),
  applyPlan: async (userId, plan, staleDayIds) => {
    // Recalcular no momento da escrita evita que o snapshot do dry-run/apply
    // sobrescreva um resumo mais novo produzido pelo trigger durante o backfill.
    const writes = plan.map((day) =>
      rebuildProgressDay(userId, day.dateKey).then(() => 'written')
    )
    const deletes = staleDayIds.map((day) =>
      rebuildProgressDay(userId, day).then(() => 'deleted')
    )
    const operations = [...writes, ...deletes]
    const settled = await Promise.allSettled(operations)
    return {
      written: settled.filter((item) => item.status === 'fulfilled' && item.value === 'written')
        .length,
      deleted: settled.filter((item) => item.status === 'fulfilled' && item.value === 'deleted')
        .length,
      failed: settled.filter((item) => item.status === 'rejected').length,
    }
  },
  log: console.log,
})
