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
let admin
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
  admin = env.authenticatedContext('admin').firestore()
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
    await setDoc(doc(db, 'users/admin'), {
      role: 'superadmin',
      subscription: { paidAt: null, trialEndsAt: Timestamp.fromMillis(Date.now() + 86400000) },
    })
    await setDoc(doc(db, 'publicProfiles/owner'), {
      username: 'owner',
      bio: 'Treino com constância',
      shareStatistics: false,
    })
    await setDoc(doc(db, 'communities/gym'), { isActive: true })
    await setDoc(doc(db, 'communities/announcements'), {
      isActive: true,
      postAccess: 'admins',
    })
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
    await setDoc(doc(db, 'communityMembers/gym_admin'), {
      userId: 'admin',
      communityId: 'gym',
      joinedAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'communityMembers/announcements_owner'), {
      userId: 'owner',
      communityId: 'announcements',
      joinedAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'communityMembers/announcements_admin'), {
      userId: 'admin',
      communityId: 'announcements',
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
    authorIsSuperAdmin: false,
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

test('photo publication requires photoPath scoped to this exact document, never another publication\'s file', async () => {
  const FILE_ID = 'AAAAAAAAAAAAAAAAAAAA' // 20 chars — mesmo formato do id gerado pelo Firestore
  const OTHER_FILE_ID = 'BBBBBBBBBBBBBBBBBBBB'
  const status = (overrides = {}) => ({
    communityId: 'gym',
    authorId: 'owner',
    authorUsername: 'owner',
    authorIsSuperAdmin: false,
    type: 'photo',
    photoPath: `statusPhotos/gym/${FILE_ID}.webp`,
    caption: 'Treino de hoje',
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
    ...overrides,
  })
  const ref = doc(owner, `statuses/${FILE_ID}`)
  await assertSucceeds(setDoc(ref, status()))
  await assertSucceeds(getDoc(doc(visitor, `statuses/${FILE_ID}`)))
  // photoPath precisa ser exatamente statusPhotos/{communityId}/{o próprio id do
  // documento}.webp — nunca o de outra publicação, mesmo com formato e comunidade
  // corretos. Sem isso, uma publicação podia "sequestrar" a foto de outra: ao ser
  // excluída, a limpeza no backend apagava do Storage um arquivo que ainda pertencia
  // a uma publicação alheia, ainda existente.
  await assertFails(
    setDoc(
      doc(owner, `statuses/${OTHER_FILE_ID}`),
      status({ photoPath: `statusPhotos/gym/${FILE_ID}.webp` })
    )
  )
  // photoPath precisa apontar para a mesma comunidade do status, nunca para outra.
  await assertFails(
    setDoc(
      doc(owner, `statuses/${FILE_ID}`),
      status({ photoPath: `statusPhotos/announcements/${FILE_ID}.webp` })
    )
  )
  // Nome de arquivo tem que bater com o formato gerado pelo servidor — nunca o nome
  // original de um arquivo do usuário, nem um caminho tentando escapar da pasta.
  await assertFails(
    setDoc(doc(owner, `statuses/${FILE_ID}`), status({ photoPath: 'statusPhotos/gym/foto.webp' }))
  )
  await assertFails(
    setDoc(
      doc(owner, `statuses/${FILE_ID}`),
      status({ photoPath: `statusPhotos/gym/../other/${FILE_ID}.webp` })
    )
  )
  const { photoPath: _omitPath, ...withoutPath } = status()
  await assertFails(setDoc(doc(owner, `statuses/${FILE_ID}`), withoutPath))
  await assertFails(
    setDoc(doc(owner, `statuses/${FILE_ID}`), status({ caption: 'x'.repeat(281) }))
  )
  const { caption: _omitCaption, ...withoutCaption } = status()
  await assertSucceeds(
    setDoc(doc(owner, `statuses/${OTHER_FILE_ID}`), {
      ...withoutCaption,
      photoPath: `statusPhotos/gym/${OTHER_FILE_ID}.webp`,
    })
  )
  await assertFails(deleteDoc(doc(visitor, `statuses/${FILE_ID}`)))
  await assertSucceeds(deleteDoc(ref))
})

test('the superadmin badge is stamped by the server, never by the client payload', async () => {
  const status = (overrides = {}) => ({
    communityId: 'gym',
    authorId: 'owner',
    authorUsername: 'owner',
    authorIsSuperAdmin: false,
    type: 'text',
    text: 'Bom treino hoje!',
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
    ...overrides,
  })
  // A regular user claiming the badge for themselves is rejected outright.
  await assertFails(setDoc(doc(owner, 'statuses/fakebadge'), status({ authorIsSuperAdmin: true })))
  // Omitting the field entirely is just as invalid as lying about it.
  const { authorIsSuperAdmin: _omit, ...withoutBadge } = status()
  await assertFails(setDoc(doc(owner, 'statuses/nobadge'), withoutBadge))
  // The real superadmin must claim the badge (false would misrepresent who posted).
  await assertFails(
    setDoc(
      doc(admin, 'statuses/underclaim'),
      status({ authorId: 'admin', authorUsername: 'admin', authorIsSuperAdmin: false })
    )
  )
  await assertSucceeds(
    setDoc(
      doc(admin, 'statuses/realbadge'),
      status({ authorId: 'admin', authorUsername: 'admin', authorIsSuperAdmin: true })
    )
  )
  assert.equal((await getDoc(doc(admin, 'statuses/realbadge'))).data().authorIsSuperAdmin, true)
})

test('malformed payloads that used to crash the feed on render are rejected server-side', async () => {
  const base = (overrides = {}) => ({
    communityId: 'gym',
    authorId: 'owner',
    authorIsSuperAdmin: false,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
    ...overrides,
  })
  // authorUsername precisa ser string ou null — outro tipo (ex.: number) quebrava
  // StatusHeader (.charAt/.toUpperCase esperando string).
  await assertFails(
    setDoc(
      doc(owner, 'statuses/badusername'),
      base({ authorUsername: 123, type: 'text', text: 'oi' })
    )
  )
  await assertSucceeds(
    setDoc(
      doc(owner, 'statuses/nullusername'),
      base({ authorUsername: null, type: 'text', text: 'oi' })
    )
  )
  // Cada opção da enquete precisa ser {id, label} — um item nulo (ou faltando algum
  // dos dois campos) quebrava PollStatus (option.id/option.label direto).
  const poll = (options) =>
    base({ authorUsername: 'owner', type: 'poll', poll: { question: 'Treinou hoje?', options } })
  await assertFails(setDoc(doc(owner, 'statuses/nulloption'), poll([null, null])))
  await assertFails(
    setDoc(doc(owner, 'statuses/missingfield'), poll([{ id: '0' }, { id: '1', label: 'Sim' }]))
  )
  await assertSucceeds(
    setDoc(
      doc(owner, 'statuses/validpoll'),
      poll([
        { id: '0', label: 'Sim' },
        { id: '1', label: 'Não' },
      ])
    )
  )
})

test('community postAccess restricts who may publish, enforced server-side', async () => {
  const status = (authorId, authorIsSuperAdmin, overrides = {}) => ({
    communityId: 'announcements',
    authorId,
    authorUsername: authorId,
    authorIsSuperAdmin,
    type: 'text',
    text: 'Aviso oficial.',
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
    ...overrides,
  })
  // A member who isn't superadmin cannot post in a restricted community...
  await assertFails(setDoc(doc(owner, 'statuses/blocked'), status('owner', false)))
  // ...not even by lying about the badge to sneak past the check.
  await assertFails(setDoc(doc(owner, 'statuses/blockedlie'), status('owner', true)))
  // The superadmin can.
  await assertSucceeds(setDoc(doc(admin, 'statuses/allowed'), status('admin', true)))
  // A community without postAccess (legacy/default) stays open to every member.
  await assertSucceeds(
    setDoc(doc(owner, 'statuses/opengym'), { ...status('owner', false), communityId: 'gym' })
  )
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
    createdAt: serverTimestamp(),
  }
  // createdAt precisa ser o carimbo do servidor no momento da criação — outro valor
  // (inclusive omitido) é rejeitado, e é imutável depois (ver teste abaixo, update).
  await assertFails(setDoc(ref, { ...workout, createdAt: Timestamp.now() }))
  const { createdAt: _omit, ...withoutCreatedAt } = workout
  await assertFails(setDoc(ref, withoutCreatedAt))
  await assertSucceeds(setDoc(ref, workout))
  await assertFails(getDoc(doc(visitor, 'users/owner/workouts/individual')))
  await assertFails(setDoc(doc(visitor, 'users/owner/workouts/individual'), workout))
  await assertFails(updateDoc(ref, { createdAt: Timestamp.now() }))
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
