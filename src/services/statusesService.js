import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
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
// authorIsSuperAdmin (selo dourado) é só a conveniência de exibição — o valor real é
// conferido pelo servidor (firestore.rules: authorIsSuperAdmin == isSuperAdmin()),
// então um usuário comum nunca consegue gravar esse campo como true.
export function createTextStatus(communityId, author, text) {
  return addDoc(statusesRef(), {
    communityId,
    authorId: author.id,
    authorUsername: author.username || null,
    authorIsSuperAdmin: author.role === 'superadmin',
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
    authorIsSuperAdmin: author.role === 'superadmin',
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
    authorIsSuperAdmin: author.role === 'superadmin',
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

// O documento de voto tem o próprio userId como id, então "meu voto" é 1 leitura direta —
// nunca precisa baixar a subcoleção inteira pra saber se (e em quê) alguém votou.
export async function getMyVote(statusId, userId) {
  const snapshot = await getDoc(doc(db, 'statuses', statusId, 'votes', userId))
  return snapshot.exists() ? snapshot.data() : null
}

// Contagem por opção via agregação no servidor: custa 1 leitura fixa por opção
// (no máximo 6, teto do schema da enquete), nunca escala com o número de votos.
export async function getPollResults(statusId, optionIds) {
  const votesRef = collection(db, 'statuses', statusId, 'votes')
  const counts = await Promise.all(
    optionIds.map(async (optionId) => {
      const snapshot = await getCountFromServer(query(votesRef, where('optionId', '==', optionId)))
      return [optionId, snapshot.data().count]
    })
  )
  return Object.fromEntries(counts)
}

export function voteOnPoll(statusId, userId, optionId) {
  return setDoc(doc(db, 'statuses', statusId, 'votes', userId), {
    optionId,
    userId,
    createdAt: serverTimestamp(),
  })
}

// Mesma ideia: id do documento é o userId, então "eu participo?" é 1 leitura direta.
export async function amIParticipant(statusId, userId) {
  const snapshot = await getDoc(doc(db, 'statuses', statusId, 'participants', userId))
  return snapshot.exists()
}

export async function countParticipants(statusId) {
  const snapshot = await getCountFromServer(collection(db, 'statuses', statusId, 'participants'))
  return snapshot.data().count
}

export function joinWorkout(statusId, userId) {
  return setDoc(doc(db, 'statuses', statusId, 'participants', userId), {
    userId,
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
    authorIsSuperAdmin: author.role === 'superadmin',
    type: 'achievement',
    achievement,
    createdAt: serverTimestamp(),
    expiresAt: expiresAtValue(),
  })
}
