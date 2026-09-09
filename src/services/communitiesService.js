import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  startAfter,
} from 'firebase/firestore'
import { db, functions } from '../firebase/config'
import { httpsCallable } from 'firebase/functions'

// Teto de defesa: comunidades só são criadas pelo superadmin pelo painel, mas sem isso
// a leitura escala com o tamanho da coleção — bem acima de qualquer uso real do app.
const MAX_COMMUNITIES = 200

function communitiesRef() {
  return collection(db, 'communities')
}

function toDoc(d) {
  return { id: d.id, ...d.data() }
}

export async function listActiveCommunities() {
  const q = query(
    communitiesRef(),
    where('isActive', '==', true),
    orderBy('name'),
    limit(MAX_COMMUNITIES)
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(toDoc)
}

export async function listCommunitiesPage(cursor = null, pageSize = 25) {
  const constraints = [orderBy('name')]
  if (cursor) constraints.push(startAfter(cursor))
  const snapshot = await getDocs(query(communitiesRef(), ...constraints, limit(pageSize)))
  return {
    items: snapshot.docs.map(toDoc),
    nextCursor: snapshot.size === pageSize ? snapshot.docs.at(-1) : null,
  }
}

export async function getCommunity(communityId) {
  const snapshot = await getDoc(doc(db, 'communities', communityId))
  return snapshot.exists() ? toDoc(snapshot) : null
}

export function createCommunity(userId, community) {
  return addDoc(communitiesRef(), {
    name: community.name.trim(),
    description: community.description?.trim() || '',
    imageUrl: community.imageUrl || null,
    isActive: true,
    createdBy: userId,
    createdAt: serverTimestamp(),
  })
}

// imageUrl não é tocado aqui de propósito — updateDoc só altera os campos enviados, então
// uma edição de nome/descrição nunca apaga a imagem já definida pela comunidade.
export function updateCommunity(communityId, community) {
  return updateDoc(doc(db, 'communities', communityId), {
    name: community.name.trim(),
    description: community.description?.trim() || '',
    isActive: community.isActive,
  })
}

export function setCommunityActive(communityId, isActive) {
  return updateDoc(doc(db, 'communities', communityId), { isActive })
}

export function deleteCommunity(communityId) {
  return httpsCallable(functions, 'deleteCommunityPermanently')({ communityId })
}
