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
  await runTransaction(db, async (tx) => {
    const profileSnap = await tx.get(userRef(userId))
    if (!profileSnap.exists()) throw new Error('PROFILE_NOT_FOUND')
    const previousUsername = profileSnap.data().username
    if (previousUsername !== patch.username) {
      const reserved = await tx.get(usernameRef(patch.username))
      if (reserved.exists() && reserved.data().uid !== userId) {
        throw new Error('USERNAME_TAKEN')
      }
      if (previousUsername) tx.delete(usernameRef(previousUsername))
      if (!reserved.exists()) {
        tx.set(usernameRef(patch.username), { uid: userId, createdAt: serverTimestamp() })
      }
    }
    tx.update(userRef(userId), patch)
    writePublic(tx)
  })
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
    return { id: snapshot.id, ...snapshot.data() }
  }
  // Cadastro e listener de autenticação podem chegar juntos: reler na transação
  // impede que uma inicialização atrasada sobrescreva um nome ou preferência novos.
  return runTransaction(db, async (tx) => {
    const current = await tx.get(ref)
    const data = current.exists() ? current.data() : { role: 'user', createdAt: serverTimestamp() }
    if (data.publicProfileVersion === 1) return { id: userId, ...data }
    const profile = { ...data, publicProfileVersion: 1, shareStatistics: false }
    tx.set(ref, profile)
    tx.set(doc(db, 'publicProfiles', userId), {
      username: data.username || null,
      bio: data.bio || null,
      shareStatistics: false,
    })
    return { id: userId, ...profile }
  })
}

// Reserva um @usuário único via transação: lê o ponteiro em "usernames" e o perfil atual
// antes de escrever, então uma corrida entre dois usuários escolhendo o mesmo nome nunca
// deixa os dois "ganharem" — o Firestore aborta e reexecuta a transação perdedora.
export async function setUsername(userId, rawUsername) {
  const username = rawUsername.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('INVALID_USERNAME')
  }

  await runTransaction(db, async (tx) => {
    const usernameSnap = await tx.get(usernameRef(username))
    if (usernameSnap.exists() && usernameSnap.data().uid !== userId) {
      throw new Error('USERNAME_TAKEN')
    }

    const profileSnap = await tx.get(userRef(userId))
    const previousUsername = profileSnap.data()?.username

    if (previousUsername && previousUsername !== username) {
      tx.delete(usernameRef(previousUsername))
    }
    if (!usernameSnap.exists()) {
      tx.set(usernameRef(username), { uid: userId, createdAt: serverTimestamp() })
    }
    tx.set(userRef(userId), { username }, { merge: true })
    tx.set(doc(db, 'publicProfiles', userId), {
      username,
      bio: profileSnap.data()?.bio || null,
      shareStatistics: profileSnap.data()?.shareStatistics === true,
    })
  })

  return username
}
