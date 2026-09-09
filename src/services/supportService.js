import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'

export async function listSupportRequests(userId, admin = false) {
  const filters = admin ? [] : [where('userId', '==', userId)]
  const result = await getDocs(
    query(collection(db, 'supportRequests'), ...filters, orderBy('createdAt', 'desc'), limit(50))
  )
  return result.docs.map((item) => ({ id: item.id, ...item.data() }))
}

export async function listModerationNotices(userId) {
  const result = await getDocs(
    query(collection(db, 'users', userId, 'notices'), orderBy('createdAt', 'desc'), limit(50))
  )
  return result.docs.map((item) => ({ id: item.id, ...item.data() }))
}

export async function submitSupportRequest(values) {
  return (await httpsCallable(functions, 'submitSupportRequest')(values)).data
}

export async function decideSupportRequest(values) {
  return (await httpsCallable(functions, 'decideSupportRequest')(values)).data
}
