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

// usageProfile: 'professional' por padrão -- a maioria destes testes exerce o fluxo
// de vitrine em si, não a elegibilidade de perfil de uso (coberta à parte, abaixo).
async function seedUser(uid, data = {}) {
  await db.doc(`users/${uid}`).set({ role: 'user', usageProfile: 'professional', ...data })
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

async function publishListing(owner, listingId, overrides = {}) {
  await seedShowcasePolicy()
  return service.publish(owner, {
    listingId,
    termsAccepted: true,
    termsVersion: showcaseManifest.version,
    operationId: unique('publication'),
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

test('creating a new listing requires an eligible usage profile; owning one already is never revoked', async () => {
  const common = unique('common')
  const legacy = unique('legacy')
  const establishment = unique('establishment')
  await Promise.all([
    seedUser(common, { usageProfile: 'common' }),
    // Conta legada: nunca declarou -- sem a chave, não apenas com um valor vazio.
    db.doc(`users/${legacy}`).set({ role: 'user' }),
    seedUser(establishment, { usageProfile: 'establishment_owner' }),
  ])

  await assert.rejects(
    service.createDraft(common, { requestId: unique('request'), kind: 'professional' }),
    (error) => error.code === 'failed-precondition'
  )
  await assert.rejects(
    service.createDraft(legacy, { requestId: unique('request'), kind: 'professional' }),
    (error) => error.code === 'failed-precondition'
  )
  await assert.doesNotReject(
    service.createDraft(establishment, { requestId: unique('request'), kind: 'professional' })
  )

  // Perder a elegibilidade depois nunca revoga o acesso a uma vitrine já existente --
  // só uma criação NOVA é barrada.
  const eligibleThenCommon = unique('eligible_then_common')
  await seedUser(eligibleThenCommon)
  const { listingId } = await service.createDraft(eligibleThenCommon, {
    requestId: unique('request'),
    kind: 'space',
  })
  await db.doc(`users/${eligibleThenCommon}`).update({ usageProfile: 'common' })
  const replay = await service.createDraft(eligibleThenCommon, {
    requestId: unique('request'),
    kind: 'space',
  })
  assert.equal(replay.listingId, listingId)
  assert.equal(replay.created, false)
})

test('unpublished storefront terms block publication even with a complete draft', async () => {
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
    unpublishedService.publish(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('publication'),
    }),
    (error) => error.code === 'failed-precondition'
  )
})

test('missing published storefront policy blocks publication without creating a legal acceptance', async () => {
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
    service.publish(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('publication'),
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

test('publication requires the current storefront terms and records an idempotent server acceptance', async () => {
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
    service.publish(owner, {
      listingId,
      termsAccepted: false,
      termsVersion: showcaseManifest.version,
      operationId: unique('publication'),
    }),
    (error) => error.code === 'failed-precondition'
  )
  await assert.rejects(
    service.publish(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: '0.9.0',
      operationId: unique('publication'),
    }),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal(
    (await db.doc(`professionalListingDrafts/${listingId}`).get()).data().reviewState,
    'draft'
  )
  assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)

  const operationId = unique('publication')
  const payload = {
    listingId,
    termsAccepted: true,
    termsVersion: showcaseManifest.version,
    operationId,
    userId: other,
    acceptedAt: Timestamp.fromMillis(1),
  }
  await service.publish(owner, payload)
  const acceptance = (
    await db.doc(`users/${owner}/showcaseLegalAcceptances/${showcaseManifest.version}`).get()
  ).data()
  assert.equal(acceptance.userId, owner)
  assert.equal(acceptance.listingId, listingId)
  assert.equal(acceptance.operationId, operationId)
  assert.equal(acceptance.documentId, showcaseManifest.documentId)
  assert.equal(typeof acceptance.acceptedAt.toMillis(), 'number')
  assert.ok(acceptance.acceptedAt.toMillis() > 1)

  const replay = await service.publish(owner, payload)
  assert.equal(replay.repeated, true)
})

test('a policy update or missing immutable archive blocks publication without changing the draft', async () => {
  const owner = unique('terms_owner')
  await seedUser(owner)
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft() })
  await seedShowcasePolicy({ version: '2.0.0', digest: 'new-digest' })

  await assert.rejects(
    service.publish(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('publication'),
    }),
    (error) => error.code === 'failed-precondition'
  )
  await seedShowcasePolicy()
  await db.doc(`showcaseLegalVersions/${showcaseManifest.version}`).delete()
  await assert.rejects(
    service.publish(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('publication'),
    }),
    (error) => error.code === 'failed-precondition'
  )
  const draft = (await db.doc(`professionalListingDrafts/${listingId}`).get()).data()
  assert.equal(draft.reviewState, 'draft')
  assert.equal(draft.publishingOperationId, undefined)
  assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)
})

test('an existing acceptance for the same immutable version is reused on a later republish', async () => {
  const owner = unique('terms_owner')
  await seedUser(owner)
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft() })
  await publishListing(owner, listingId)
  await service.saveDraft(owner, {
    listingId,
    draft: completeDraft('professional', { displayName: 'Ana Treinadora II' }),
  })

  await seedShowcasePolicy()
  await assert.doesNotReject(
    service.publish(owner, {
      listingId,
      termsAccepted: false,
      termsVersion: showcaseManifest.version,
      operationId: unique('publication'),
    })
  )
})

test('owner isolation, authorized community link and immediate self-publication are enforced', async () => {
  const owner = unique('owner')
  const intruder = unique('intruder')
  const communityId = unique('community')
  await Promise.all([seedUser(owner), seedUser(intruder)])
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
  await seedShowcasePolicy()
  await assert.rejects(
    service.publish(intruder, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('publication'),
    }),
    (error) => error.code === 'permission-denied'
  )
  await publishListing(owner, listingId)

  const publicSnapshot = await db.doc(`publishedProfessionalListings/${listingId}`).get()
  assert.equal(publicSnapshot.data().displayName, 'Ana Treinadora')
  assert.equal(publicSnapshot.data().linkedCommunity.name, 'Equipe Norte')
  assert.equal(publicSnapshot.data().ownerId, undefined)
})

test('editing after publication never replaces the live projection until republished', async () => {
  const owner = unique('owner')
  await seedUser(owner)
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'space',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft('space') })
  await publishListing(owner, listingId)

  await service.saveDraft(owner, {
    listingId,
    draft: completeDraft('space', { displayName: 'Nome ainda não publicado' }),
  })
  assert.equal(
    (await db.doc(`publishedProfessionalListings/${listingId}`).get()).data().displayName,
    'Espaço Movimento'
  )

  // Uma publicação que falha (política revogada nesta janela) também não deve
  // vazar a edição ainda não confirmada para o card público.
  await db.doc('showcaseLegalPolicy/current').delete()
  await assert.rejects(
    service.publish(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('publication'),
    }),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal(
    (await db.doc(`publishedProfessionalListings/${listingId}`).get()).data().displayName,
    'Espaço Movimento'
  )

  await publishListing(owner, listingId)
  assert.equal(
    (await db.doc(`publishedProfessionalListings/${listingId}`).get()).data().displayName,
    'Nome ainda não publicado'
  )
})

test('publication always uses the currently authorized avatar, never a stale one', async () => {
  const owner = unique('owner')
  const firstMediaId = db.collection('profileAvatarMedia').doc().id
  const secondMediaId = db.collection('profileAvatarMedia').doc().id
  const firstPath = `profileAvatars/${owner}/${firstMediaId}.webp`
  const secondPath = `profileAvatars/${owner}/${secondMediaId}.webp`
  await Promise.all([
    seedUser(owner, { avatarMediaId: firstMediaId, avatarPath: firstPath }),
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
  await publishListing(owner, listingId)

  const firstPublished = (await db.doc(`publishedProfessionalListings/${listingId}`).get()).data()
  assert.equal(firstPublished.avatarSourceMediaId, firstMediaId)
  assert.deepEqual(files.get(firstPublished.avatarPath), Buffer.from('first-avatar'))

  await db.doc(`profileAvatarMedia/${secondMediaId}`).set({
    ownerId: owner,
    storagePath: secondPath,
    state: 'active',
  })
  await db.doc(`profileAvatarMedia/${firstMediaId}`).update({ state: 'superseded' })
  await db.doc(`users/${owner}`).update({ avatarMediaId: secondMediaId, avatarPath: secondPath })
  await service.saveDraft(owner, {
    listingId,
    draft: completeDraft('professional', { useProfileAvatar: true }),
  })
  await publishListing(owner, listingId)

  const secondPublished = (
    await db.doc(`publishedProfessionalListings/${listingId}`).get()
  ).data()
  assert.equal(secondPublished.avatarSourceMediaId, secondMediaId)
  assert.deepEqual(files.get(secondPublished.avatarPath), Buffer.from('second-avatar'))
})

test('publication keeps the default avatar when no authorized photo was saved', async () => {
  const owner = unique('owner_no_avatar')
  await seedUser(owner)
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft() })
  await publishListing(owner, listingId)

  const published = (await db.doc(`publishedProfessionalListings/${listingId}`).get()).data()
  assert.equal(published.avatarPath, undefined)
  assert.equal(published.avatarSourceMediaId, undefined)
})

test('publication rejects an allocated or revoked avatar instead of exposing it', async () => {
  for (const mediaState of ['allocated', 'deleted']) {
    const owner = unique(`owner_${mediaState}`)
    const mediaId = db.collection('profileAvatarMedia').doc().id
    const sourcePath = `profileAvatars/${owner}/${mediaId}.webp`
    await Promise.all([
      seedUser(owner, { avatarMediaId: mediaId, avatarPath: sourcePath }),
      db.doc(`profileAvatarMedia/${mediaId}`).set({
        ownerId: owner,
        storagePath: sourcePath,
        state: mediaState,
      }),
    ])
    files.set(sourcePath, Buffer.from(mediaState))
    const { listingId } = await service.createDraft(owner, {
      requestId: unique('request'),
      kind: 'professional',
    })
    await service.saveDraft(owner, {
      listingId,
      draft: completeDraft('professional', { useProfileAvatar: true }),
    })

    await assert.rejects(publishListing(owner, listingId), /não está mais disponível/)
    assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)
    // Uma publicação que falhou por causa do avatar não deve deixar a vitrine
    // travada em "publishing" -- uma nova tentativa (ex.: depois de desmarcar a
    // autorização) precisa continuar possível.
    await assert.doesNotReject(
      service.saveDraft(owner, { listingId, draft: completeDraft() })
    )
  }
})

test('publication revalidates linked community ownership and active state', async () => {
  const owner = unique('owner')
  const communityId = unique('community')
  await seedUser(owner)
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
  await db.doc(`communities/${communityId}`).update({ isActive: false })

  await assert.rejects(
    publishListing(owner, listingId),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)
})

test('unauthorized community ownership is rejected and a published listing can be suspended', async () => {
  const owner = unique('owner')
  const otherOwner = unique('other')
  const admin = unique('admin')
  const communityId = unique('community')
  await Promise.all([seedUser(owner), seedUser(otherOwner), seedUser(admin, { role: 'superadmin' })])
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
  await publishListing(owner, listingId)

  await service.suspend(admin, { listingId, reason: 'Conteúdo incompatível.' })
  assert.equal((await db.doc(`publishedProfessionalListings/${listingId}`).get()).exists, false)
  assert.equal(
    (await db.doc(`professionalListings/${listingId}`).get()).data().lifecycleState,
    'suspended'
  )
  await assert.rejects(
    service.saveDraft(owner, { listingId, draft: completeDraft() }),
    (error) => error.code === 'failed-precondition'
  )
})

test('a publish that loses a race with another attempt is aborted instead of overwriting it', async () => {
  const owner = unique('owner')
  await seedUser(owner)
  const { listingId } = await service.createDraft(owner, {
    requestId: unique('request'),
    kind: 'professional',
  })
  await service.saveDraft(owner, { listingId, draft: completeDraft() })
  await seedShowcasePolicy()
  const draftRef = db.doc(`professionalListingDrafts/${listingId}`)
  // Simula uma primeira chamada de publish() já em andamento (trava fresca).
  await draftRef.update({
    reviewState: 'publishing',
    publishingOperationId: unique('other_publication'),
    publishingStartedAt: Timestamp.now(),
  })
  await assert.rejects(
    service.publish(owner, {
      listingId,
      termsAccepted: true,
      termsVersion: showcaseManifest.version,
      operationId: unique('publication'),
    }),
    (error) => error.code === 'aborted'
  )
  // Uma trava expirada (instância derrubada no meio de uma publicação antiga) não
  // deve travar a vitrine para sempre -- sem nenhum admin para destravá-la.
  await draftRef.update({
    publishingStartedAt: Timestamp.fromMillis(Date.now() - 10 * 60 * 1000),
  })
  await assert.doesNotReject(publishListing(owner, listingId))
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
