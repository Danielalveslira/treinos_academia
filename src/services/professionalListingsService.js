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
export function submitProfessionalListing(listingId, legalAcceptance) {
  return call('submitProfessionalListing', { listingId, ...legalAcceptance })
}
export function reviewProfessionalListing(listingId, decision, reason = '') {
  return call('reviewProfessionalListing', { listingId, decision, reason })
}
export function unpublishProfessionalListing(listingId) {
  return call('unpublishProfessionalListing', { listingId })
}
export function suspendProfessionalListing(listingId, reason) {
  return call('suspendProfessionalListing', { listingId, reason })
}
export function reportProfessionalListing(listingId, message) {
  return call('reportProfessionalListing', { listingId, message })
}
export function resolveProfessionalListingReport(reportId, action, reason = '') {
  return call('resolveProfessionalListingReport', { reportId, action, reason })
}
export function deleteProfessionalListing(listingId) {
  return call('deleteProfessionalListing', { listingId })
}

export async function getMyProfessionalListing(userId) {
  const lock = await getDoc(doc(db, 'professionalListingOwnerLocks', userId))
  if (!lock.exists()) return null
  const listingId = lock.data().listingId
  const [listing, draft, published] = await Promise.all([
    getDoc(doc(db, 'professionalListings', listingId)),
    getDoc(doc(db, 'professionalListingDrafts', listingId)),
    getDoc(doc(db, 'publishedProfessionalListings', listingId)),
  ])
  return {
    id: listingId,
    listing: listing.exists() ? listing.data() : null,
    draft: draft.exists() ? draft.data() : null,
    published: published.exists() ? published.data() : null,
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

export async function listPublishedProfessionalListings(filters, cursor = null) {
  const constraints = [
    where('publicationStatus', '==', 'published'),
    where('filterKeys', 'array-contains', listingFilterKey(filters)),
    orderBy('sortKey'),
  ]
  if (cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(LISTINGS_PAGE_SIZE))
  const snapshot = await getDocs(
    query(collection(db, 'publishedProfessionalListings'), ...constraints)
  )
  return {
    items: snapshot.docs.map(toItem),
    nextCursor: snapshot.size === LISTINGS_PAGE_SIZE ? snapshot.docs.at(-1) : null,
  }
}

export async function listPendingProfessionalListings() {
  const snapshot = await getDocs(
    query(
      collection(db, 'professionalListingDrafts'),
      where('reviewState', '==', 'pending_review'),
      orderBy('submittedAt'),
      limit(50)
    )
  )
  return snapshot.docs.map(toItem)
}

export async function listOpenShowcaseReports() {
  const snapshot = await getDocs(
    query(
      collection(db, 'showcaseReports'),
      where('state', '==', 'open'),
      orderBy('createdAt'),
      limit(50)
    )
  )
  return snapshot.docs.map(toItem)
}
