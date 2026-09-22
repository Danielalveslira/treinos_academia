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
import { httpsCallable } from 'firebase/functions'
import { ref as storageRef, uploadBytesResumable, getBytes } from 'firebase/storage'
import { db, storage, functions } from '../firebase/config'
import { validateAchievement } from '../utils/achievements'

const FEED_PAGE_SIZE = 30
// Próximos treinos (Treino Marcado V1): teto de defesa, não paginação -- uma comunidade
// real dificilmente tem mais que isso de eventos futuros simultâneos; se algum dia
// precisar de mais, é um cursor novo, não um número maior aqui.
const UPCOMING_WORKOUTS_PAGE_SIZE = 20
const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000
const listWorkoutParticipantsCallable = httpsCallable(functions, 'listWorkoutParticipants')
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

// O documento nasce antes do upload. A criação dele passa pelas regras completas do
// Firestore (termos, restrições, filiação e configuração da comunidade), e o Storage
// precisa consultar somente esse documento para autorizar os bytes. Isso
// mantém as regras do Storage dentro do limite de duas consultas cruzadas por operação.
// Se o envio falhar ou for cancelado, removemos o documento; o gatilho de exclusão e a
// varredura de órfãos continuam sendo a rede de segurança para falhas de rede.
// uploadBytesResumable (em vez de uploadBytes) é o que permite progresso e cancelamento
// reais no formulário, em vez de só um spinner indeterminado.
export async function createPhotoStatus(
  communityId,
  author,
  { blob, caption },
  { onProgress } = {}
) {
  const statusRef = doc(statusesRef())
  const photoPath = `statusPhotos/${communityId}/${statusRef.id}.webp`
  await setDoc(statusRef, {
    ...baseStatusFields(communityId, author, 'photo'),
    photoPath,
    caption: caption ? caption.trim() : '',
  })
  const task = uploadBytesResumable(storageRef(storage, photoPath), blob, {
    contentType: 'image/webp',
  })
  const done = new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => onProgress?.(snapshot.bytesTransferred / snapshot.totalBytes),
      async (error) => {
        try {
          await deleteDoc(statusRef)
        } catch {
          // O job de expiração remove qualquer documento residual em até 24h.
        }
        reject(error)
      },
      () => resolve(statusRef)
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

// "Próximos treinos" (Treino Marcado V1) -- consulta própria, independente do feed
// recente (que filtra por expiresAt, sem nenhuma relação com a data do evento, ver
// canJoinWorkout em firestore.rules). Busca só workout.date > agora, ordenado pelo
// evento mais próximo primeiro -- nunca lê todos os statuses da comunidade para filtrar
// no cliente, nunca um listener (mesmo raciocínio de listCommunityFeed: 1 leitura sob
// demanda, cacheada pelo hook que a chama). Índice composto necessário:
// statuses(communityId ASC, type ASC, workout.date ASC) -- ver firestore.indexes.json.
export async function listUpcomingWorkouts(communityId, pageSize = UPCOMING_WORKOUTS_PAGE_SIZE) {
  const q = query(
    statusesRef(),
    where('communityId', '==', communityId),
    where('type', '==', 'workout'),
    where('workout.date', '>', Timestamp.now()),
    orderBy('workout.date', 'asc'),
    limit(pageSize)
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(toDoc)
}

// Resolve o alvo de um link #treino-{id} mesmo quando ele ficou fora do limite 20 da
// consulta acima. É um get direto sujeito à mesma Rule de statuses/{id}: somente membro
// da comunidade do próprio status consegue lê-lo. A checagem de communityId impede um
// treino válido de outra comunidade de ser exibido na rota atual.
export async function getSharedWorkout(statusId, communityId) {
  const snapshot = await getDoc(doc(db, 'statuses', statusId))
  if (!snapshot.exists()) return null
  const status = toDoc(snapshot)
  return status.type === 'workout' && status.communityId === communityId ? status : null
}

// "Ver participantes" -- callable dedicada (listWorkoutParticipants, mesmo padrão de
// listPostEconomyVoters), nunca N getDoc separados por participante: users/{uid} só é
// legível pelo próprio dono (ver firestore.rules), então resolver username por
// participante exige o servidor (Admin SDK) de qualquer forma. cursor é o valor
// devolvido em nextCursor da página anterior (null na primeira página).
export async function listWorkoutParticipants(statusId, { cursor = null, limit = 20 } = {}) {
  return (await listWorkoutParticipantsCallable({ statusId, cursor, limit })).data
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
