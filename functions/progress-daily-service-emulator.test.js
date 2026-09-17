import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createProgressDailyService } from './progress-daily-service.js'

test(
  'rebuildProgressDay uses a real Firestore transaction and remains idempotent',
  { skip: !process.env.FIRESTORE_EMULATOR_HOST },
  async () => {
    const app = getApps()[0] || initializeApp({ projectId: 'demo-treinos' })
    const db = getFirestore(app)
    const uid = `progress-service-${Date.now()}`
    const dateKey = '2026-09-16'
    const rebuildProgressDay = createProgressDailyService({ db, Timestamp, FieldValue })

    await db.doc(`users/${uid}`).set({ role: 'user' })
    await Promise.all([
      db.doc(`users/${uid}/workouts/one`).set({
        exerciseId: 'squat',
        type: 'strength',
        date: Timestamp.fromDate(new Date('2026-09-16T12:00:00Z')),
        setDetails: [{ weight: 50, reps: 10 }],
      }),
      db.doc(`users/${uid}/workouts/two`).set({
        exerciseId: 'run',
        type: 'cardio',
        date: Timestamp.fromDate(new Date('2026-09-16T15:00:00Z')),
        durationMinutes: 20,
      }),
    ])

    await Promise.all(Array.from({ length: 4 }, () => rebuildProgressDay(uid, dateKey)))
    const first = (await db.doc(`users/${uid}/progressDaily/${dateKey}`).get()).data()
    assert.equal(first.workoutCount, 2)
    assert.equal(first.strengthVolumeKg, 500)
    assert.equal(first.cardioMinutes, 20)

    await rebuildProgressDay(uid, dateKey)
    const second = (await db.doc(`users/${uid}/progressDaily/${dateKey}`).get()).data()
    assert.deepEqual(
      { ...second, updatedAt: undefined },
      { ...first, updatedAt: undefined }
    )
  }
)
