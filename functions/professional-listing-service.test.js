import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { initializeApp, getApps } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createProfessionalListingService } from './professional-listing-service.js'
import { legalDigest } from './legal-core.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
if (getApps().length === 0) initializeApp({ projectId: 'demo-treinos-functions-test' })
const db = getFirestore()

function FakeHttpsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

const files = new Map()
const failDeletesOnce = new Set()
const bucket = {
  file(path) {
    return {
      async copy(destination) {
        files.set(destination.name || destination.path, files.get(path) || Buffer.from('avatar'))
      },
      async setMetadata() {},
      async delete() {
        if (failDeletesOnce.delete(path)) throw new Error('transient storage failure')
        files.delete(path)
      },
      name: path,
      path,
    }
  },
  async getFiles({ prefix }) {
    return [
      [...files.keys()].filter((path) => path.startsWith(prefix)).map((path) => bucket.file(path)),
    ]
  },
}

const showcaseManifest = {
  documentId: 'showcase-publication-terms',
  version: '1.0.0',
  published: true,
}
const showcaseDocument = { id: showcaseManifest.documentId, title: 'Termos da Vitrine' }
const showcaseDigest = legalDigest(showcaseManifest, [showcaseDocument])
const service = createProfessionalListingService({
  db,
  bucket,
  FieldValue,
  Timestamp,
  HttpsError: FakeHttpsError,
  showcaseLegal: { manifest: showcaseManifest, digest: showcaseDigest },
})
let sequence = 0
const unique = (prefix) => `${prefix}_${Date.now()}_${sequence++}`

const completeDraft = (kind = 'professional', overrides = {}) => ({
  kind,
  displayName: kind === 'professional' ? 'Ana Treinadora' : 'Espaço Movimento',
  categoryKey: kind === 'professional' ? 'personal_trainer' : 'studio',
  modalityKeys: ['musculacao'],
  specialties: ['Hipertrofia'],
  bio: 'Acompanhamento individual e responsável.',
  city: 'São Paulo',
  uf: 'SP',
  serviceMode: 'hybrid',
  contacts: { website: 'https://example.com', whatsapp: '', instagram: '' },
  linkedCommunityId: null,
  useProfileAvatar: false,
  ...overrides,
})

async function seedUser(uid, data = {}) {
  await db.doc(`users/${uid}`).set({ role: 'user', ...data })
}

async function seedShowcasePolicy(overrides = {}) {
  await Promise.all([
    db.doc('showcaseLegalPolicy/current').set({
      documentId: showcaseManifest.documentId,
      version: showcaseManifest.version,
      digest: showcaseDigest,
      published: true,
      ...overrides,
    }),
    db.doc(`showcaseLegalVersions/${showcaseManifest.version}`).set({
      manifest: showcaseManifest,
      document: showcaseDocument,
      digest: showcaseDigest,
    }),
  ])
}

async function submitListing(owner, listingId, overrides = {}) {
  await seedShowcasePolicy()
  return service.submit(owner, {
    listingId,
    termsAccepted: true,
    termsVersion: showcaseManifest.version,
    operationId: unique('submission'),
    ...overrides,
  })
}

test('concurrent and replayed creation produces exactly one listing per account', async () => {
  const uid = unique('listing_owner')
  await seedUser(uid)
  const results = await Promise.all([
    service.createDraft(uid, { requestId: unique('request'), kind: 'professional' }),
    service.createDraft(uid, { requestId: unique('request'), kind: 'professional' }),
  ])
  assert.equal(results[0].listingId, results[1].listingId)
  const listings = await db.collection('professionalListings').where('ownerId', '==', uid).get()
  assert.equal(listings.size, 1)
})

test('unpublished storefront terms block submission even with a complete draft', async () => {
  const owner = unique('terms_unpublished')
  await seedUser(owner)
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft() })
  const unpublishedService = createProfessionalListingService({
    db,
    bucket,
    FieldValue,
    HttpsError: FakeHttpsError,
    showcaseLegal: {
      manifest: { ...showcaseManifest, published: false },
      digest: showcaseDigest,
    },
  })
  await assert.rejects(
    unpublishedService.submit(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('submission'),
    }),
    (error) => error.code === 'failed-precondition'
  )
})

test('missing published storefront policy blocks submission without creating a legal acceptance', async () => {
  await db.doc('showcaseLegalPolicy/current').delete()
  await db.doc(`showcaseLegalVersions/${showcaseManifest.version}`).delete()
  const owner = unique('terms_missing')
  await seedUser(owner)
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft() })
  await assert.rejects(
    service.submit(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('submission'),
    }),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal(
    (await db.doc(`users/${owner}/showcaseLegalAcceptances/${showcaseManifest.version}`).get())
      .exists,
    false
  )
  assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)
})

test('submission requires the current storefront terms and records an idempotent server acceptance', async () => {
  const owner = unique('terms_owner')
  const other = unique('terms_other')
  await Promise.all([seedUser(owner), seedUser(other), seedShowcasePolicy()])
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft() })
  await db.doc(`users/${other}/showcaseLegalAcceptances/${showcaseManifest.version}`).set({
    userId: other,
    listingId,
    documentId: showcaseManifest.documentId,
    version: showcaseManifest.version,
    digest: showcaseDigest,
    acceptedAt: Timestamp.now(),
  })

  await assert.rejects(
    service.submit(owner, {
      listingId,
      termsAccepted: false,
      termsVersion: showcaseManifest.version,
      operationId: unique('submission'),
    }),
    (error) => error.code === 'failed-precondition'
  )
  await assert.rejects(
    service.submit(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: '0.9.0',
      operationId: unique('submission'),
    }),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal(
    (await db.doc(`professionalListingDrafts/${listingId}`).get()).data().reviewState,
    'draft'
  )
  assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)

  const operationId = unique('submission')
  const payload = {
    listingId,
    termsAccepted: true,
    termsVersion: showcaseManifest.version,
    operationId,
    userId: other,
    acceptedAt: Timestamp.fromMillis(1),
  }
  await service.submit(owner, payload)
  const acceptance = (
    await db.doc(`users/${owner}/showcaseLegalAcceptances/${showcaseManifest.version}`).get()
  ).data()
  assert.equal(acceptance.userId, owner)
  assert.equal(acceptance.listingId, listingId)
  assert.equal(acceptance.operationId, operationId)
  assert.equal(acceptance.documentId, showcaseManifest.documentId)
  assert.equal(typeof acceptance.acceptedAt.toMillis(), 'number')
  assert.ok(acceptance.acceptedAt.toMillis() > 1)

  const replay = await service.submit(owner, payload)
  assert.equal(replay.repeated, true)
})

test('a policy update or missing immutable archive blocks submission without changing the draft', async () => {
  const owner = unique('terms_owner')
  await seedUser(owner)
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft() })
  await seedShowcasePolicy({ version: '2.0.0', digest: 'new-digest' })

  await assert.rejects(
    service.submit(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('submission'),
    }),
    (error) => error.code === 'failed-precondition'
  )
  await seedShowcasePolicy()
  await db.doc(`showcaseLegalVersions/${showcaseManifest.version}`).delete()
  await assert.rejects(
    service.submit(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('submission'),
    }),
    (error) => error.code === 'failed-precondition'
  )
  const draft = (await db.doc(`professionalListingDrafts/${listingId}`).get()).data()
  assert.equal(draft.reviewState, 'draft')
  assert.equal(draft.submittedAt, undefined)
  assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)
})

test('an existing acceptance for the same immutable version is reused after rejection', async () => {
  const owner = unique('terms_owner')
  const admin = unique('terms_admin')
  await Promise.all([seedUser(owner), seedUser(admin, { role: 'superadmin' })])
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft() })
  await submitListing(owner, listingId)
  await service.review(admin, {
    listingId,
    decision: 'rejected',
    reason: 'Ajuste necessário no conteúdo.',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft() })

  await seedShowcasePolicy()
  await assert.doesNotReject(
    service.submit(owner, {
      listingId,
      termsAccepted: false,
      termsVersion: showcaseManifest.version,
      operationId: unique('submission'),
    })
  )
})

test('owner isolation, authorized community link and administrative approval are enforced', async () => {
  const owner = unique('owner')
  const intruder = unique('intruder')
  const admin = unique('admin')
  const communityId = unique('community')
  await Promise.all([seedUser(owner), seedUser(intruder), seedUser(admin, { role: 'superadmin' })])
  await db
    .doc(`communities/${communityId}`)
    .set({ ownerId: owner, name: 'Equipe Norte', isActive: true })
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })

  await assert.rejects(
    service.saveDraft(intruder, { listingId, draft: completeDraft() }),
    (error) => error.code === 'permission-denied'
  )
  await service.saveDraft(owner, {
    listingId,
    draft: completeDraft('professional', { linkedCommunityId: communityId }),
  })
  await submitListing(owner, listingId)
  await service.review(admin, { listingId, decision: 'approved' })

  const publicSnapshot = await db.doc(`publishedProfessionalListings/${listingId}`).get()
  assert.equal(publicSnapshot.data().displayName, 'Ana Treinadora')
  assert.equal(publicSnapshot.data().linkedCommunity.name, 'Equipe Norte')
  assert.equal(publicSnapshot.data().ownerId, undefined)
})

test('pending edits and rejection never replace the previously approved projection', async () => {
  const owner = unique('owner')
  const admin = unique('admin')
  await Promise.all([seedUser(owner), seedUser(admin, { role: 'superadmin' })])
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'space',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft('space') })
  await submitListing(owner, listingId)
  await service.review(admin, { listingId, decision: 'approved' })

  await service.saveDraft(owner, {
    listingId,
    draft: completeDraft('space', { displayName: 'Nome ainda pendente' }),
  })
  await submitListing(owner, listingId)
  assert.equal(
    (await db.doc(`publishedProfessionalListings/${listingId}`).get()).data().displayName,
    'Espaço Movimento'
  )
  await service.review(admin, { listingId, decision: 'rejected', reason: 'Nome não comprovado.' })
  assert.equal(
    (await db.doc(`publishedProfessionalListings/${listingId}`).get()).data().displayName,
    'Espaço Movimento'
  )
})

test('approval uses the avatar version pinned at submission, not a later personal avatar', async () => {
  const owner = unique('owner')
  const admin = unique('admin')
  const firstMediaId = db.collection('profileAvatarMedia').doc().id
  const secondMediaId = db.collection('profileAvatarMedia').doc().id
  const firstPath = `profileAvatars/${owner}/${firstMediaId}.webp`
  const secondPath = `profileAvatars/${owner}/${secondMediaId}.webp`
  await Promise.all([
    seedUser(owner, { avatarMediaId: firstMediaId, avatarPath: firstPath }),
    seedUser(admin, { role: 'superadmin' }),
    db.doc(`profileAvatarMedia/${firstMediaId}`).set({
      ownerId: owner,
      storagePath: firstPath,
      state: 'active',
    }),
  ])
  files.set(firstPath, Buffer.from('first-avatar'))
  files.set(secondPath, Buffer.from('second-avatar'))
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, {
    listingId,
    draft: completeDraft('professional', { useProfileAvatar: true }),
  })
  await submitListing(owner, listingId)
  await db.doc(`users/${owner}`).update({
    avatarMediaId: secondMediaId,
    avatarPath: secondPath,
  })
  await service.review(admin, { listingId, decision: 'approved' })

  const published = (await db.doc(`publishedProfessionalListings/${listingId}`).get()).data()
  assert.equal(published.avatarSourceMediaId, firstMediaId)
  assert.deepEqual(files.get(published.avatarPath), Buffer.from('first-avatar'))
})

test('approval revalidates linked community ownership and active state', async () => {
  const owner = unique('owner')
  const admin = unique('admin')
  const communityId = unique('community')
  await Promise.all([seedUser(owner), seedUser(admin, { role: 'superadmin' })])
  await db.doc(`communities/${communityId}`).set({
    ownerId: owner,
    name: 'Comunidade temporária',
    isActive: true,
  })
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, {
    listingId,
    draft: completeDraft('professional', { linkedCommunityId: communityId }),
  })
  await submitListing(owner, listingId)
  await db.doc(`communities/${communityId}`).update({ isActive: false })

  await assert.rejects(
    service.review(admin, { listingId, decision: 'approved' }),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)
})

test('unauthorized community ownership is rejected and reports can suspend a public listing', async () => {
  const owner = unique('owner')
  const otherOwner = unique('other')
  const reporter = unique('reporter')
  const admin = unique('admin')
  const communityId = unique('community')
  await Promise.all([
    seedUser(owner),
    seedUser(otherOwner),
    seedUser(reporter),
    seedUser(admin, { role: 'superadmin' }),
  ])
  await db
    .doc(`communities/${communityId}`)
    .set({ ownerId: otherOwner, name: 'Alheia', isActive: true })
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await assert.rejects(
    service.saveDraft(owner, {
      listingId,
      draft: completeDraft('professional', { linkedCommunityId: communityId }),
    }),
    (error) => error.code === 'permission-denied'
  )
  await service.saveDraft(owner, { listingId, draft: completeDraft() })
  await submitListing(owner, listingId)
  await service.review(admin, { listingId, decision: 'approved' })
  const { reportId } = await service.report(reporter, {
    listingId,
    message: 'Conteúdo comercial enganoso.',
  })
  await service.resolveReport(admin, {
    reportId,
    action: 'suspend',
    reason: 'Conteúdo incompatível.',
  })
  assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)
  assert.equal(
    (await db.doc(`professionalListings/${listingId}`).get()).data().lifecycleState,
    'suspended'
  )
  const repeated = await service.resolveReport(admin, {
    reportId,
    action: 'suspend',
    reason: 'Conteúdo incompatível.',
  })
  assert.equal(repeated.repeated, true)
  await assert.rejects(
    service.resolveReport(admin, { reportId, action: 'no_action' }),
    (error) => error.code === 'aborted'
  )
  await assert.rejects(
    service.saveDraft(owner, { listingId, draft: completeDraft() }),
    (error) => error.code === 'failed-precondition'
  )
})

test('listing deletion is safely retryable after a partial Storage failure', async () => {
  const owner = unique('owner')
  await seedUser(owner)
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  const mediaPath = `professionalListingMedia/${listingId}/approved/test.webp`
  files.set(mediaPath, Buffer.from('approved-avatar'))
  failDeletesOnce.add(mediaPath)
  await db.doc(`publishedProfessionalListings/${listingId}`).set({
    publicationStatus: 'published',
    avatarPath: mediaPath,
  })

  await assert.rejects(service.deleteListing(owner, { listingId }), /transient storage failure/)
  assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)
  assert.equal(
    (await db.doc(`professionalListings/${listingId}`).get()).data().lifecycleState,
    'deleting'
  )
  assert.equal((await db.doc(`professionalListingOwnerLocks/${owner}`).get()).exists, true)

  await service.deleteListing(owner, { listingId })
  assert.equal((await db.doc(`professionalListings/${listingId}`).get()).exists, false)
  assert.equal((await db.doc(`professionalListingOwnerLocks/${owner}`).get()).exists, false)
  assert.equal(files.has(mediaPath), false)
})

test('directory filters run before cursor pagination and support combined and empty results', async () => {
  const prefix = unique('directory')
  const broadKey = `professional|*|*|${prefix}|*`
  const combinedKey = `professional|corrida|SP|${prefix}|hybrid`
  const batch = db.batch()
  for (let index = 0; index < 25; index += 1) {
    batch.set(db.collection('publishedProfessionalListings').doc(), {
      publicationStatus: 'published',
      sortKey: `${prefix}_${String(index).padStart(2, '0')}`,
      filterKeys: index < 3 ? [broadKey, combinedKey] : [broadKey],
    })
  }
  await batch.commit()

  const base = db
    .collection('publishedProfessionalListings')
    .where('publicationStatus', '==', 'published')
    .where('filterKeys', 'array-contains', broadKey)
    .orderBy('sortKey')
  const firstPage = await base.limit(20).get()
  const secondPage = await base.startAfter(firstPage.docs.at(-1)).limit(20).get()
  assert.equal(firstPage.size, 20)
  assert.equal(secondPage.size, 5)
  assert.equal(
    firstPage.docs.some((item) => secondPage.docs.some((next) => next.id === item.id)),
    false
  )

  const combined = await db
    .collection('publishedProfessionalListings')
    .where('publicationStatus', '==', 'published')
    .where('filterKeys', 'array-contains', combinedKey)
    .orderBy('sortKey')
    .get()
  assert.equal(combined.size, 3)

  const empty = await db
    .collection('publishedProfessionalListings')
    .where('publicationStatus', '==', 'published')
    .where('filterKeys', 'array-contains', 'space|yoga|AC|rio branco|online')
    .orderBy('sortKey')
    .get()
  assert.equal(empty.empty, true)
})
