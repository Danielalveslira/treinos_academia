import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'
import { listingFilterKey } from '../utils/professionalListing'

export const LISTINGS_PAGE_SIZE = 20
const call = (name, data) => httpsCallable(functions, name)(data).then((result) => result.data)
const toItem = (snapshot) => ({ id: snapshot.id, ...snapshot.data() })

export function createProfessionalListing(
  kind,
  requestId = crypto.randomUUID().replaceAll('-', '')
) {
  return call('createProfessionalListingDraft', { kind, requestId: requestId.slice(0, 128) })
}
export function saveProfessionalListing(listingId, draft) {
  return call('saveProfessionalListingDraft', { listingId, draft })
}
export function publishProfessionalListing(listingId, legalAcceptance) {
  return call('publishProfessionalListing', { listingId, ...legalAcceptance })
}
export function unpublishProfessionalListing(listingId) {
  return call('unpublishProfessionalListing', { listingId })
}
export function suspendProfessionalListing(listingId, reason) {
  return call('suspendProfessionalListing', { listingId, reason })
}
export function deleteProfessionalListing(listingId) {
  return call('deleteProfessionalListing', { listingId })
}

export async function getMyProfessionalListing(userId) {
  const lock = await getDoc(doc(db, 'professionalListingOwnerLocks', userId))
  if (!lock.exists()) return null
  const listingId = lock.data().listingId
  const [listing, draft] = await Promise.all([
    getDoc(doc(db, 'professionalListings', listingId)),
    getDoc(doc(db, 'professionalListingDrafts', listingId)),
  ])
  let published = null
  if (listing.exists() && listing.data().lifecycleState === 'published') {
    try {
      const projection = await getDoc(doc(db, 'publishedProfessionalListings', listingId))
      published = projection.exists() ? projection.data() : null
    } catch (error) {
      // A projeção pode ter sido removida entre a leitura do registro e esta consulta.
      // As Rules negam até o get de um documento ausente; a edição privada segue disponível.
      if (error?.code !== 'permission-denied') throw error
    }
  }
  return {
    id: listingId,
    listing: listing.exists() ? listing.data() : null,
    draft: draft.exists() ? draft.data() : null,
    published,
  }
}

export async function getShowcaseLegalAcceptance(userId, version) {
  const snapshot = await getDoc(doc(db, 'users', userId, 'showcaseLegalAcceptances', version))
  return snapshot.exists() ? snapshot.data() : null
}

export async function getPublishedProfessionalListing(listingId) {
  const snapshot = await getDoc(doc(db, 'publishedProfessionalListings', listingId))
  return snapshot.exists() ? toItem(snapshot) : null
}

export async function listPublishedProfessionalListings(
  filters,
  cursor = null,
  pageSize = LISTINGS_PAGE_SIZE
) {
  const constraints = [
    where('publicationStatus', '==', 'published'),
    where('filterKeys', 'array-contains', listingFilterKey(filters)),
    orderBy('sortKey'),
  ]
  if (cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(pageSize))
  const snapshot = await getDocs(
    query(collection(db, 'publishedProfessionalListings'), ...constraints)
  )
  return {
    items: snapshot.docs.map(toItem),
    nextCursor: snapshot.size === pageSize ? snapshot.docs.at(-1) : null,
  }
}
