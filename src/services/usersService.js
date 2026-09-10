import { doc, getDoc, writeBatch, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getWorkoutStatistics } from './workoutsService'

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/

function userRef(userId) {
  return doc(db, 'users', userId)
}

function usernameRef(username) {
  return doc(db, 'usernames', username)
}

export const BIO_MAX_LENGTH = 300

// Reserva o @ (ou confirma que já é seu) numa transação isolada, só com o documento
// usernames/{username} — sem tocar em users/publicProfiles nela. Isso é o que garante
// exclusividade sob corrida (duas reservas concorrentes do mesmo nome novo: o Firestore
// detecta o conflito de leitura/escrita e reexecuta a perdedora). Ficar só nesse
// documento também é necessário para as regras: elas agora exigem que users/publicProfiles
// só gravem um username se a reserva correspondente já existir e apontar pro mesmo uid
// (ver ownsUsernameField em firestore.rules) — e regras nunca enxergam a escrita de OUTRO
// documento feita na mesma transação, só o que já está confirmado no banco. Por isso a
// reserva precisa ser seu próprio commit, sempre antes de gravar o perfil.
async function reserveUsername(userId, username) {
  await runTransaction(db, async (tx) => {
    const reserved = await tx.get(usernameRef(username))
    if (reserved.exists()) {
      if (reserved.data().uid !== userId) throw new Error('USERNAME_TAKEN')
      return
    }
    tx.set(usernameRef(username), { uid: userId, createdAt: serverTimestamp() })
  })
}

// Recebe apenas campos alterados. Descrição não precisa consultar a reserva de nomes.
export async function updateUserProfile(userId, changes) {
  const patch = {}
  if (Object.hasOwn(changes, 'bio')) {
    const bio = (changes.bio || '').trim()
    if (bio.length > BIO_MAX_LENGTH) throw new Error('BIO_TOO_LONG')
    patch.bio = bio || null
  }
  if (Object.hasOwn(changes, 'username')) {
    patch.username = changes.username.trim().toLowerCase()
    if (!USERNAME_PATTERN.test(patch.username)) throw new Error('INVALID_USERNAME')
  }
  if (Object.hasOwn(changes, 'shareStatistics')) {
    if (typeof changes.shareStatistics !== 'boolean') throw new Error('INVALID_PRIVACY')
    patch.shareStatistics = changes.shareStatistics
  }
  if (!Object.keys(patch).length) return patch
  const statistics = patch.shareStatistics === true ? await getWorkoutStatistics(userId) : null
  function writePublic(writer) {
    writer.set(doc(db, 'publicProfiles', userId), patch, { merge: true })
    if (statistics)
      writer.set(doc(db, 'publicProfiles', userId, 'statistics', 'summary'), {
        ...statistics,
        updatedAt: serverTimestamp(),
      })
    if (patch.shareStatistics === false)
      writer.delete(doc(db, 'publicProfiles', userId, 'statistics', 'summary'))
  }
  if (!Object.hasOwn(patch, 'username')) {
    const batch = writeBatch(db)
    batch.update(userRef(userId), patch)
    writePublic(batch)
    await batch.commit()
    return patch
  }
  const profileSnap = await getDoc(userRef(userId))
  if (!profileSnap.exists()) throw new Error('PROFILE_NOT_FOUND')
  const previousUsername = profileSnap.data().username
  if (previousUsername !== patch.username) {
    await reserveUsername(userId, patch.username)
  }
  const batch = writeBatch(db)
  batch.update(userRef(userId), patch)
  writePublic(batch)
  if (previousUsername && previousUsername !== patch.username) {
    batch.delete(usernameRef(previousUsername))
  }
  await batch.commit()
  return patch
}

// Checagem somente-leitura, usada para bloquear o cadastro antes de criar a conta no
// Authentication. Não reserva o nome — a reserva definitiva e à prova de corrida
// continua acontecendo dentro da transação de setUsername.
export async function isUsernameAvailable(username) {
  const snapshot = await getDoc(usernameRef(username.trim().toLowerCase()))
  return !snapshot.exists()
}

export async function ensureUserProfile(userId) {
  const ref = userRef(userId)
  const snapshot = await getDoc(ref)
  if (snapshot.exists() && snapshot.data().publicProfileVersion === 1) {
    return { ...snapshot.data(), id: snapshot.id }
  }
  // Cadastro e listener de autenticação podem chegar juntos: reler na transação
  // impede que uma inicialização atrasada sobrescreva um nome ou preferência novos.
  return runTransaction(db, async (tx) => {
    const current = await tx.get(ref)
    const data = current.exists() ? current.data() : { role: 'user', createdAt: serverTimestamp() }
    if (data.publicProfileVersion === 1) return { ...data, id: userId }
    const profile = { ...data, publicProfileVersion: 1, shareStatistics: false }
    tx.set(ref, profile)
    tx.set(doc(db, 'publicProfiles', userId), {
      username: data.username || null,
      bio: data.bio || null,
      shareStatistics: false,
    })
    return { ...profile, id: userId }
  })
}

// Reserva o @ (own transação, ver reserveUsername acima) e só então grava o perfil —
// nessa ordem porque as regras do servidor agora exigem que a reserva já exista e
// aponte pro mesmo uid antes de aceitar um username em users/publicProfiles.
export async function setUsername(userId, rawUsername) {
  const username = rawUsername.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('INVALID_USERNAME')
  }

  const profileSnap = await getDoc(userRef(userId))
  const previousUsername = profileSnap.data()?.username

  if (previousUsername !== username) {
    await reserveUsername(userId, username)
  }

  const batch = writeBatch(db)
  batch.set(userRef(userId), { username }, { merge: true })
  batch.set(doc(db, 'publicProfiles', userId), {
    username,
    bio: profileSnap.data()?.bio || null,
    shareStatistics: profileSnap.data()?.shareStatistics === true,
  })
  if (previousUsername && previousUsername !== username) {
    batch.delete(usernameRef(previousUsername))
  }
  await batch.commit()

  return username
}
