import { collection, getDocs, limit, orderBy, query, where, startAfter } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'

export async function listSupportRequestsPage(
  userId,
  admin = false,
  { state = '', cursor = null } = {}
) {
  const filters = admin ? [] : [where('userId', '==', userId)]
  if (admin && state) filters.push(where('state', '==', state))
  filters.push(orderBy('createdAt', 'desc'))
  if (cursor) filters.push(startAfter(cursor))
  const result = await getDocs(query(collection(db, 'supportRequests'), ...filters, limit(25)))
  return {
    items: result.docs.map((item) => ({ ...item.data(), id: item.id })),
    nextCursor: result.size === 25 ? result.docs.at(-1) : null,
  }
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
