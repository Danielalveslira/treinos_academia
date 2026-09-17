import { collection, documentId, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'

export async function listProgressDays(userId, startDateKey, endDateKey) {
  const snapshot = await getDocs(
    query(
      collection(db, 'users', userId, 'progressDaily'),
      where(documentId(), '>=', startDateKey),
      where(documentId(), '<=', endDateKey),
      orderBy(documentId())
    )
  )
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}
