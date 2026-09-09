import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  getCountFromServer,
} from 'firebase/firestore'
import { db } from '../firebase/config'

function membersRef() {
  return collection(db, 'communityMembers')
}

function membershipId(communityId, userId) {
  return `${communityId}_${userId}`
}

export async function listMyCommunityIds(userId) {
  const q = query(membersRef(), where('userId', '==', userId), orderBy('joinedAt', 'desc'))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => d.data().communityId)
}

export async function isMember(communityId, userId) {
  const snapshot = await getDoc(doc(db, 'communityMembers', membershipId(communityId, userId)))
  return snapshot.exists()
}

export function joinCommunity(communityId, userId) {
  return setDoc(doc(db, 'communityMembers', membershipId(communityId, userId)), {
    communityId,
    userId,
    joinedAt: serverTimestamp(),
  })
}

export function leaveCommunity(communityId, userId) {
  return deleteDoc(doc(db, 'communityMembers', membershipId(communityId, userId)))
}

export async function countMembers(communityId) {
  const q = query(membersRef(), where('communityId', '==', communityId))
  const snapshot = await getCountFromServer(q)
  return snapshot.data().count
}
