import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { validateAchievement } from '../utils/achievements'

const FEED_PAGE_SIZE = 30
const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000

function statusesRef() {
  return collection(db, 'statuses')
}

function toDoc(d) {
  return { id: d.id, ...d.data() }
}

function expiresAtValue() {
  return Timestamp.fromMillis(Date.now() + STATUS_LIFETIME_MS)
}

export async function listCommunityFeed(communityId, pageSize = FEED_PAGE_SIZE) {
  // expiresAt = createdAt + 24h (deslocamento fixo), então ordenar por expiresAt desc
  // equivale a ordenar por createdAt desc (mais recentes primeiro) e ainda satisfaz a
  // exigência do Firestore de que o primeiro orderBy acompanhe o campo do filtro de
  // desigualdade.
  const q = query(
    statusesRef(),
    where('communityId', '==', communityId),
    where('expiresAt', '>', Timestamp.now()),
    orderBy('expiresAt', 'desc'),
    limit(pageSize)
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(toDoc)
}

// authorUsername é gravado no próprio status (denormalizado) para o feed poder mostrar
// quem publicou sem precisar de 1 leitura extra em "users" por item exibido. Nunca o
// e-mail: é um dado sensível e não deveria aparecer publicamente na comunidade.
export function createTextStatus(communityId, author, text) {
  return addDoc(statusesRef(), {
    communityId,
    authorId: author.id,
    authorUsername: author.username || null,
    type: 'text',
    text: text.trim(),
    createdAt: serverTimestamp(),
    expiresAt: expiresAtValue(),
  })
}

export function createPollStatus(communityId, author, question, options) {
  return addDoc(statusesRef(), {
    communityId,
    authorId: author.id,
    authorUsername: author.username || null,
    type: 'poll',
    poll: {
      question: question.trim(),
      options: options.map((label, index) => ({ id: String(index), label: label.trim() })),
    },
    createdAt: serverTimestamp(),
    expiresAt: expiresAtValue(),
  })
}

export function createWorkoutStatus(communityId, author, workout) {
  return addDoc(statusesRef(), {
    communityId,
    authorId: author.id,
    authorUsername: author.username || null,
    type: 'workout',
    workout: {
      title: workout.title.trim(),
      date: Timestamp.fromDate(new Date(workout.date)),
      location: workout.location.trim(),
    },
    createdAt: serverTimestamp(),
    expiresAt: expiresAtValue(),
  })
}

export function deleteStatus(statusId) {
  return deleteDoc(doc(db, 'statuses', statusId))
}

export async function listVotes(statusId) {
  const snapshot = await getDocs(collection(db, 'statuses', statusId, 'votes'))
  return snapshot.docs.map((d) => ({ userId: d.id, ...d.data() }))
}

export function voteOnPoll(statusId, userId, optionId) {
  return setDoc(doc(db, 'statuses', statusId, 'votes', userId), {
    optionId,
    createdAt: serverTimestamp(),
  })
}

export async function listParticipants(statusId) {
  const snapshot = await getDocs(collection(db, 'statuses', statusId, 'participants'))
  return snapshot.docs.map((d) => ({ userId: d.id, ...d.data() }))
}

export function joinWorkout(statusId, userId) {
  return setDoc(doc(db, 'statuses', statusId, 'participants', userId), {
    joinedAt: serverTimestamp(),
  })
}

export function leaveWorkout(statusId, userId) {
  return deleteDoc(doc(db, 'statuses', statusId, 'participants', userId))
}

export function createAchievementStatus(communityId, author, values) {
  const error = validateAchievement(values)
  if (error) throw new Error(error)
  const achievement = {
    day: values.day,
    text: values.text.trim(),
    entries: values.entries,
    sets: values.sets,
  }
  return addDoc(statusesRef(), {
    communityId,
    authorId: author.id,
    authorUsername: author.username || null,
    type: 'achievement',
    achievement,
    createdAt: serverTimestamp(),
    expiresAt: expiresAtValue(),
  })
}
