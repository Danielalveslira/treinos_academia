import { MAX_WORKOUT_SETS } from '../src/utils/workoutSets.js'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
  query,
  where,
  getAggregateFromServer,
  count,
  sum,
} from 'firebase/firestore'

let env
let owner
let visitor
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-treinos',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
  await env.clearFirestore()
  owner = env.authenticatedContext('owner').firestore()
  visitor = env.authenticatedContext('visitor').firestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users/owner'), {
      role: 'user',
      email: 'private@example.com',
      username: 'owner',
      subscription: { paidAt: null, trialEndsAt: Timestamp.fromMillis(Date.now() + 86400000) },
    })
    await setDoc(doc(db, 'users/visitor'), {
      role: 'user',
      subscription: { paidAt: null, trialEndsAt: Timestamp.fromMillis(Date.now() + 86400000) },
    })
    await setDoc(doc(db, 'publicProfiles/owner'), {
      username: 'owner',
      bio: 'Treino com constância',
      shareStatistics: false,
    })
    await setDoc(doc(db, 'communities/gym'), { isActive: true })
    await setDoc(doc(db, 'communityMembers/gym_owner'), {
      userId: 'owner',
      communityId: 'gym',
      joinedAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'communityMembers/gym_visitor'), {
      userId: 'visitor',
      communityId: 'gym',
      joinedAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'users/owner/workouts/a'), {
      exerciseId: 'squat',
      weight: 30,
      sets: 3,
      reps: 12,
      date: Timestamp.fromDate(new Date('2026-09-09T12:00:00Z')),
    })
  })
})
after(async () => {
  await env?.cleanup()
})

test('public profile exposes only the allowed fields; private profile/history remain forbidden', async () => {
  const result = await assertSucceeds(getDoc(doc(visitor, 'publicProfiles/owner')))
  assert.deepEqual(Object.keys(result.data()).sort(), ['bio', 'shareStatistics', 'username'])
  await assertFails(getDoc(doc(visitor, 'users/owner')))
  await assertFails(getDocs(collection(visitor, 'users/owner/workouts')))
  await assertFails(getDocs(collection(visitor, 'publicProfiles')))
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'publicProfiles/owner')))
  await assertFails(updateDoc(doc(owner, 'publicProfiles/owner'), { email: 'leak@example.com' }))
  await assertFails(updateDoc(doc(visitor, 'publicProfiles/owner'), { bio: 'overwrite' }))
})

test('opt-in publishes totals atomically; opt-out blocks direct reads and stale summary writes', async () => {
  const summary = (db) => doc(db, 'publicProfiles/owner/statistics/summary')
  await assertFails(getDoc(summary(visitor)))
  const batch = writeBatch(owner)
  batch.update(doc(owner, 'publicProfiles/owner'), { shareStatistics: true })
  batch.set(summary(owner), { entries: 1, sets: 3, updatedAt: serverTimestamp() })
  await assertSucceeds(batch.commit())
  assert.equal((await assertSucceeds(getDoc(summary(visitor)))).data().sets, 3)
  await assertFails(getDocs(collection(visitor, 'users/owner/workouts')))
  await assertFails(
    setDoc(summary(visitor), { entries: 9, sets: 99, updatedAt: serverTimestamp() })
  )
  await assertFails(updateDoc(summary(owner), { email: 'secret@example.com' }))
  const hide = writeBatch(owner)
  hide.update(doc(owner, 'publicProfiles/owner'), { shareStatistics: false })
  hide.delete(summary(owner))
  await assertSucceeds(hide.commit())
  await assertFails(getDoc(summary(visitor)))
  await assertFails(setDoc(summary(owner), { entries: 1, sets: 3, updatedAt: serverTimestamp() }))
})

test('daily aggregate is allowed only to the owner and returns server totals', async () => {
  const aggregate = (db) =>
    getAggregateFromServer(
      query(
        collection(db, 'users/owner/workouts'),
        where('date', '>=', Timestamp.fromDate(new Date('2026-09-09T00:00:00Z'))),
        where('date', '<', Timestamp.fromDate(new Date('2026-09-10T00:00:00Z')))
      ),
      { entries: count(), sets: sum('sets') }
    )
  assert.deepEqual((await assertSucceeds(aggregate(owner))).data(), { entries: 1, sets: 3 })
  await assertFails(aggregate(visitor))
})

test('achievement publication requires membership and safe payload; author may delete', async () => {
  const achievement = { day: '2026-09-09', text: 'Treino concluído!', entries: 1, sets: 3 }
  const status = (overrides = {}) => ({
    communityId: 'gym',
    authorId: 'owner',
    authorUsername: 'owner',
    type: 'achievement',
    achievement,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
    ...overrides,
  })
  const ref = doc(owner, 'statuses/achievement')
  await assertSucceeds(setDoc(ref, status()))
  await assertSucceeds(getDoc(doc(visitor, 'statuses/achievement')))
  await assertFails(
    setDoc(
      doc(owner, 'statuses/bad'),
      status({ achievement: { ...achievement, email: 'leak@example.com' } })
    )
  )
  await assertFails(
    setDoc(doc(owner, 'statuses/negative'), status({ achievement: { ...achievement, sets: -1 } }))
  )
  const outsider = env.authenticatedContext('outsider').firestore()
  await assertFails(setDoc(doc(outsider, 'statuses/outsider'), status({ authorId: 'outsider' })))
  await assertFails(deleteDoc(doc(visitor, 'statuses/achievement')))
  await assertSucceeds(deleteDoc(ref))
})

test('individual workout sets are validated at every position and preserve aggregate counts', async () => {
  const ref = doc(owner, 'users/owner/workouts/individual')
  const workout = {
    exerciseId: 'squat',
    setDetails: [
      { weight: 0, reps: 12 },
      { weight: 35.25, reps: 8 },
    ],
    sets: 2,
    date: Timestamp.fromDate(new Date('2025-01-01T12:00:00Z')),
    note: '',
  }
  await assertSucceeds(setDoc(ref, workout))
  await assertFails(getDoc(doc(visitor, 'users/owner/workouts/individual')))
  await assertFails(setDoc(doc(visitor, 'users/owner/workouts/individual'), workout))
  await assertSucceeds(updateDoc(ref, { setDetails: [...workout.setDetails].reverse() }))
  assert.deepEqual((await getDoc(ref)).data().setDetails, [...workout.setDetails].reverse())
  await assertFails(updateDoc(ref, { sets: 3 }))
  await assertFails(updateDoc(ref, { setDetails: [], sets: 0 }))
  await assertFails(updateDoc(ref, { weight: 30, reps: 12 }))
  await assertFails(
    updateDoc(ref, {
      setDetails: Array(MAX_WORKOUT_SETS + 1).fill({ weight: 1, reps: 1 }),
      sets: MAX_WORKOUT_SETS + 1,
    })
  )
  await assertSucceeds(
    updateDoc(ref, {
      setDetails: Array(MAX_WORKOUT_SETS).fill({ weight: 1, reps: 1 }),
      sets: MAX_WORKOUT_SETS,
    })
  )
  for (let index = 0; index < MAX_WORKOUT_SETS; index++) {
    const setDetails = Array.from({ length: MAX_WORKOUT_SETS }, () => ({ weight: 1, reps: 1 }))
    setDetails[index].weight = -1
    await assertFails(updateDoc(ref, { setDetails, sets: MAX_WORKOUT_SETS }))
  }
  for (const set of [
    { weight: NaN, reps: 1 },
    { weight: Infinity, reps: 1 },
    { weight: 1, reps: 0 },
    { weight: 1, reps: 1.5 },
    { weight: '1', reps: 1 },
    { weight: 1, reps: 1, extra: true },
    { weight: 1 },
    null,
  ]) {
    await assertFails(updateDoc(ref, { setDetails: [set], sets: 1 }))
  }
  await assertSucceeds(updateDoc(ref, { setDetails: [workout.setDetails[0]], sets: 1 }))
  const total = await getAggregateFromServer(collection(owner, 'users/owner/workouts'), {
    sets: sum('sets'),
  })
  assert.equal(total.data().sets, 4)
  await assertSucceeds(deleteDoc(ref))
})

test('legacy workouts remain readable and can be converted on edit', async () => {
  const ref = doc(owner, 'users/owner/workouts/legacy-edit')
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), ref.path), {
      exerciseId: 'squat',
      weight: 30,
      sets: 3,
      reps: 12,
      date: Timestamp.now(),
    })
  })
  assert.equal((await assertSucceeds(getDoc(ref))).data().sets, 3)
  await assertSucceeds(
    setDoc(ref, {
      exerciseId: 'squat',
      sets: 3,
      setDetails: Array(3).fill({ weight: 30, reps: 12 }),
      date: Timestamp.now(),
    })
  )
  await assertSucceeds(deleteDoc(ref))
})
