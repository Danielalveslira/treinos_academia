import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

function userRef(userId) {
  return doc(db, 'users', userId)
}

export async function ensureUserProfile(userId) {
  const ref = userRef(userId)
  const snapshot = await getDoc(ref)
  if (snapshot.exists()) return { id: snapshot.id, ...snapshot.data() }

  const profile = { role: 'user', createdAt: serverTimestamp() }
  await setDoc(ref, profile)
  return { id: userId, ...profile }
}
