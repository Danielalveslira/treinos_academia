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
import { ref as storageRef, uploadBytesResumable, getBytes } from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { validateAchievement } from '../utils/achievements'

const FEED_PAGE_SIZE = 30
const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000
// Um pouco acima de MAX_OUTPUT_BYTES (utils/imageCompression.js) só de folga — nunca
// deveria ter um objeto maior que isso em statusPhotos/, pois storage.rules recusa
// qualquer upload além desse teto.
const MAX_PHOTO_DOWNLOAD_BYTES = 5 * 1024 * 1024

function statusesRef() {
  return collection(db, 'statuses')
}

function toDoc(d) {
  return { id: d.id, ...d.data() }
}

function expiresAtValue() {
  return Timestamp.fromMillis(Date.now() + STATUS_LIFETIME_MS)
}

// Campos comuns a toda publicação de comunidade, para não repetir o mesmo bloco em
// cada create*Status abaixo (texto, enquete, treino marcado, conquista e foto).
// authorUsername é gravado no próprio status (denormalizado) para o feed poder mostrar
// quem publicou sem precisar de 1 leitura extra em "users" por item exibido. Nunca o
// e-mail: é um dado sensível e não deveria aparecer publicamente na comunidade.
// authorIsSuperAdmin (selo dourado) é só a conveniência de exibição — o valor real é
// conferido pelo servidor (firestore.rules: authorIsSuperAdmin == isSuperAdmin()),
// então um usuário comum nunca consegue gravar esse campo como true.
function baseStatusFields(communityId, author, type) {
  return {
    communityId,
    authorId: author.id,
    authorUsername: author.username || null,
    authorIsSuperAdmin: author.role === 'superadmin',
    type,
    createdAt: serverTimestamp(),
    expiresAt: expiresAtValue(),
  }
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

export function createTextStatus(communityId, author, text) {
  return addDoc(statusesRef(), {
    ...baseStatusFields(communityId, author, 'text'),
    text: text.trim(),
  })
}

export function createPollStatus(communityId, author, question, options) {
  return addDoc(statusesRef(), {
    ...baseStatusFields(communityId, author, 'poll'),
    poll: {
      question: question.trim(),
      options: options.map((label, index) => ({ id: String(index), label: label.trim() })),
    },
  })
}

export function createWorkoutStatus(communityId, author, workout) {
  return addDoc(statusesRef(), {
    ...baseStatusFields(communityId, author, 'workout'),
    workout: {
      title: workout.title.trim(),
      date: Timestamp.fromDate(new Date(workout.date)),
      location: workout.location.trim(),
    },
  })
}

// A foto é enviada direto ao Storage pelo cliente (mais simples e mais barato do que
// fazer uma Cloud Function retransmitir os bytes) — o que garante que ela não fica
// órfã lá é a combinação de dois fatores: o nome do arquivo é sempre o id do próprio
// status (nunca o nome original do arquivo do usuário, ver storage.rules) e, se o
// setDoc abaixo nunca chegar a acontecer, purgeOrphanedPhotos (functions/index.js)
// apaga qualquer arquivo sem documento correspondente depois de uma folga de 1h.
// uploadBytesResumable (em vez de uploadBytes) é o que permite progresso e cancelamento
// reais no formulário, em vez de só um spinner indeterminado.
export function createPhotoStatus(communityId, author, { blob, caption }, { onProgress } = {}) {
  const statusRef = doc(statusesRef())
  const photoPath = `statusPhotos/${communityId}/${statusRef.id}.webp`
  const task = uploadBytesResumable(storageRef(storage, photoPath), blob, {
    contentType: 'image/webp',
  })
  const done = new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => onProgress?.(snapshot.bytesTransferred / snapshot.totalBytes),
      reject,
      () => {
        setDoc(statusRef, {
          ...baseStatusFields(communityId, author, 'photo'),
          photoPath,
          caption: caption ? caption.trim() : '',
        })
          .then(() => resolve(statusRef))
          .catch(reject)
      }
    )
  })
  return { task, done }
}

export async function getStatusPhotoBlob(photoPath) {
  const bytes = await getBytes(storageRef(storage, photoPath), MAX_PHOTO_DOWNLOAD_BYTES)
  return new Blob([bytes], { type: 'image/webp' })
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
    ...baseStatusFields(communityId, author, 'achievement'),
    achievement,
  })
}
