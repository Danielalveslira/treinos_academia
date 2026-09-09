import { doc, getDoc, setDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/

function userRef(userId) {
  return doc(db, 'users', userId)
}

function usernameRef(username) {
  return doc(db, 'usernames', username)
}

export const BIO_MAX_LENGTH = 300

export async function updateBio(userId, rawBio) {
  const bio = (rawBio || '').trim()
  if (bio.length > BIO_MAX_LENGTH) {
    throw new Error('BIO_TOO_LONG')
  }
  await setDoc(userRef(userId), { bio: bio || null }, { merge: true })
  return bio
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
  if (snapshot.exists()) return { id: snapshot.id, ...snapshot.data() }

  const profile = { role: 'user', createdAt: serverTimestamp() }
  await setDoc(ref, profile)
  return { id: userId, ...profile }
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
  })

  return username
}
