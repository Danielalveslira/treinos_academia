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
  limit,
  serverTimestamp,
  getCountFromServer,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { invalidateCommunitiesCache } from '../utils/pageCache'

// Teto de defesa: bem acima do número de comunidades que existem no app (ver
// MAX_COMMUNITIES em communitiesService.js), então nunca deveria cortar uso real.
const MAX_MEMBERSHIPS = 200

function membersRef() {
  return collection(db, 'communityMembers')
}

function membershipId(communityId, userId) {
  return `${communityId}_${userId}`
}

export async function listMyCommunityIds(userId) {
  const q = query(
    membersRef(),
    where('userId', '==', userId),
    orderBy('joinedAt', 'desc'),
    limit(MAX_MEMBERSHIPS)
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => d.data().communityId)
}

export async function isMember(communityId, userId) {
  const snapshot = await getDoc(doc(db, 'communityMembers', membershipId(communityId, userId)))
  return snapshot.exists()
}

// Chamado tanto por useCommunities.js (lista) quanto por CommunityDetail.jsx (tela da
// comunidade) -- invalidar a cache da lista aqui, num único lugar, cobre os dois
// caminhos sem duplicar a chamada em cada componente.
export async function joinCommunity(communityId, userId) {
  await setDoc(doc(db, 'communityMembers', membershipId(communityId, userId)), {
    communityId,
    userId,
    joinedAt: serverTimestamp(),
  })
  invalidateCommunitiesCache(userId)
}

export async function leaveCommunity(communityId, userId) {
  await deleteDoc(doc(db, 'communityMembers', membershipId(communityId, userId)))
  invalidateCommunitiesCache(userId)
}

export async function countMembers(communityId) {
  const q = query(membersRef(), where('communityId', '==', communityId))
  const snapshot = await getCountFromServer(q)
  return snapshot.data().count
}

// Fase 5: só quem as Rules já deixam listar todos os membros de uma comunidade
// consegue algo além do próprio doc (superadmin, ou o dono dela -- ver isCommunityOwner
// em firestore.rules). Usado pela seção "Gerenciar comunidade" para moderar
// membros/banimentos.
export async function listCommunityMembers(communityId) {
  const q = query(membersRef(), where('communityId', '==', communityId), limit(MAX_MEMBERSHIPS))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}
