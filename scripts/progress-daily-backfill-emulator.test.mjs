import test from 'node:test'
import assert from 'node:assert/strict'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { runProgressDailyBackfill } from './progress-daily-backfill-core.mjs'

test(
  'two real dry-runs against the emulator are identical and write nothing',
  { skip: !process.env.FIRESTORE_EMULATOR_HOST },
  async () => {
    const app = getApps()[0] || initializeApp({ projectId: 'demo-treinos' })
    const db = getFirestore(app)
    const uid = 'backfill-test-user'
    await db.doc(`users/${uid}`).set({ role: 'user' })
    await db.doc(`users/${uid}/workouts/strength`).set({
      exerciseId: 'squat',
      type: 'strength',
      date: Timestamp.fromDate(new Date('2026-09-16T15:00:00Z')),
      setDetails: [{ weight: 50, reps: 10 }],
    })
    const dependencies = {
      loadUser: async (userId) => (await db.doc(`users/${userId}`).get()).exists,
      loadWorkouts: async (userId) =>
        (await db.collection(`users/${userId}/workouts`).get()).docs.map((item) => item.data()),
      loadExistingDayIds: async (userId) =>
        (await db.collection(`users/${userId}/progressDaily`).get()).docs.map((item) => item.id),
      applyPlan: async () => {
        throw new Error('dry-run tentou gravar')
      },
    }
    const first = await runProgressDailyBackfill({ uid, apply: false, ...dependencies })
    const second = await runProgressDailyBackfill({ uid, apply: false, ...dependencies })
    assert.deepEqual(first, second)
    assert.equal((await db.collection(`users/${uid}/progressDaily`).get()).empty, true)
  }
)
