import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getWorkoutStatistics } from './workoutsService'

export async function getPublicProfile(userId) {
  const snapshot = await getDoc(doc(db, 'publicProfiles', userId))
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
}

export async function getPublicStatistics(userId) {
  const snapshot = await getDoc(doc(db, 'publicProfiles', userId, 'statistics', 'summary'))
  return snapshot.exists() ? snapshot.data() : null
}

export async function refreshPublicStatistics(userId) {
  const statistics = await getWorkoutStatistics(userId)
  await setDoc(doc(db, 'publicProfiles', userId, 'statistics', 'summary'), {
    ...statistics,
    updatedAt: serverTimestamp(),
  })
}
