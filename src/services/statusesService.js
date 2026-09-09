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

// authorEmail é gravado no próprio status (denormalizado) para o feed poder mostrar quem
// publicou sem precisar de 1 leitura extra em "users" por item exibido.
export function createTextStatus(communityId, author, text) {
  return addDoc(statusesRef(), {
    communityId,
    authorId: author.id,
    authorEmail: author.email,
    type: 'text',
    text: text.trim(),
    createdAt: serverTimestamp(),
    expiresAt: expiresAtValue(),
  })
}

// A imagem precisa de um caminho no Storage antes do documento existir, então o ID é
// gerado no cliente (doc() sem argumentos só aloca um ID, não escreve nada) e reutilizado
// tanto para o caminho do arquivo quanto para o documento em statuses.
export function newStatusId() {
  return doc(statusesRef()).id
}

export function createPhotoStatus(statusId, communityId, author, imageUrl, text) {
  return setDoc(doc(db, 'statuses', statusId), {
    communityId,
    authorId: author.id,
    authorEmail: author.email,
    type: 'photo',
    imageUrl,
    text: text?.trim() || '',
    createdAt: serverTimestamp(),
    expiresAt: expiresAtValue(),
  })
}

export function createPollStatus(communityId, author, question, options) {
  return addDoc(statusesRef(), {
    communityId,
    authorId: author.id,
    authorEmail: author.email,
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
    authorEmail: author.email,
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
