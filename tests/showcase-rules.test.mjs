import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'

let env
let owner
let outsider
let admin
let anonymous
let legalArchive13
let legalArchive14
const listingId = 'listing_rules_v1'

before(async () => {
  legalArchive13 = JSON.parse(
    await readFile(new URL('../functions/legal/test-fixtures/1.3.0.json', import.meta.url), 'utf8')
  )
  legalArchive14 = {
    manifest: JSON.parse(await readFile(new URL('../functions/legal/manifest.json', import.meta.url), 'utf8')),
    documents: JSON.parse(await readFile(new URL('../functions/legal/documents.json', import.meta.url), 'utf8')),
    digest: JSON.parse(await readFile(new URL('../functions/legal/approved-digests.json', import.meta.url), 'utf8'))['1.4.0'],
  }
  env = await initializeTestEnvironment({
    projectId: 'demo-treinos',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
  await env.clearFirestore()
  owner = env.authenticatedContext('showcase-owner').firestore()
  outsider = env.authenticatedContext('showcase-outsider').firestore()
  admin = env.authenticatedContext('showcase-admin').firestore()
  anonymous = env.unauthenticatedContext().firestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'legalVersions/1.3.0'), legalArchive13)
    await setDoc(doc(db, 'legalVersions/1.4.0'), legalArchive14)
    await setDoc(doc(db, 'users/showcase-owner'), { role: 'user' })
    await setDoc(doc(db, 'users/showcase-outsider'), { role: 'user' })
    await setDoc(doc(db, 'users/showcase-admin'), { role: 'superadmin' })
    await setDoc(doc(db, 'usernames/showcase_owner'), { uid: 'showcase-owner' })
    await setDoc(doc(db, 'publicProfiles/showcase-owner'), {
      username: 'showcase_owner',
      bio: null,
      shareStatistics: false,
    })
    await setDoc(doc(db, `professionalListings/${listingId}`), {
      ownerId: 'showcase-owner',
      kind: 'professional',
      lifecycleState: 'published',
    })
    await setDoc(doc(db, `professionalListingDrafts/${listingId}`), {
      ownerId: 'showcase-owner',
      reviewState: 'draft',
      submittedAt: new Date(),
    })
    await setDoc(doc(db, 'professionalListingOwnerLocks/showcase-owner'), {
      ownerId: 'showcase-owner',
      listingId,
    })
    await setDoc(doc(db, `publishedProfessionalListings/${listingId}`), {
      publicationStatus: 'published',
      displayName: 'Vitrine pública',
      sortKey: 'vitrine publica',
      filterKeys: ['professional|*|*|*|*'],
    })
    await setDoc(doc(db, 'showcaseReports/report_rules_v1'), {
      listingId,
      reporterId: 'showcase-outsider',
      state: 'open',
      message: 'Teste',
    })
    await setDoc(doc(db, 'showcaseLegalPolicy/current'), {
      documentId: 'showcase-publication-terms',
      version: '1.0.0',
      digest: 'showcase-digest',
      published: true,
    })
    await setDoc(doc(db, 'showcaseLegalVersions/1.0.0'), {
      digest: 'showcase-digest',
      document: { id: 'showcase-publication-terms' },
    })
    await setDoc(doc(db, 'users/showcase-owner/showcaseLegalAcceptances/1.0.0'), {
      userId: 'showcase-owner',
      listingId,
      documentId: 'showcase-publication-terms',
      version: '1.0.0',
      digest: 'showcase-digest',
      acceptedAt: new Date(),
    })
  })
})

after(async () => env?.cleanup())

test('anonymous visitors can read published projections and filtered directory queries', async () => {
  const item = await assertSucceeds(
    getDoc(doc(anonymous, `publishedProfessionalListings/${listingId}`))
  )
  assert.equal(item.data().displayName, 'Vitrine pública')
  const result = await assertSucceeds(
    getDocs(
      query(
        collection(anonymous, 'publishedProfessionalListings'),
        where('publicationStatus', '==', 'published'),
        where('filterKeys', 'array-contains', 'professional|*|*|*|*'),
        orderBy('sortKey'),
        limit(20)
      )
    )
  )
  assert.equal(result.size, 1)
})

test('anonymous users can read immutable legal archives for either supported policy version but cannot write them', async () => {
  for (const version of ['1.3.0', '1.4.0']) {
    const archive = await assertSucceeds(getDoc(doc(anonymous, `legalVersions/${version}`)))
    assert.equal(archive.data().manifest.version, version)
  }
  await assertFails(setDoc(doc(anonymous, 'legalVersions/1.3.0'), { forged: true }))
})

test('anonymous and unrelated users cannot read authoritative or draft records', async () => {
  await assertFails(getDoc(doc(anonymous, `professionalListings/${listingId}`)))
  await assertFails(getDoc(doc(outsider, `professionalListings/${listingId}`)))
  await assertFails(getDoc(doc(outsider, `professionalListingDrafts/${listingId}`)))
  await assertSucceeds(getDoc(doc(owner, `professionalListings/${listingId}`)))
  await assertSucceeds(getDoc(doc(owner, `professionalListingDrafts/${listingId}`)))
  await assertSucceeds(getDoc(doc(owner, 'professionalListingOwnerLocks/showcase-owner')))
})

test('client writes cannot forge approval, ownership or public content', async () => {
  await assertFails(
    updateDoc(doc(owner, `professionalListings/${listingId}`), { lifecycleState: 'published' })
  )
  await assertFails(
    updateDoc(doc(owner, `professionalListingDrafts/${listingId}`), { displayName: 'Forjado' })
  )
  await assertFails(
    updateDoc(doc(owner, `publishedProfessionalListings/${listingId}`), { displayName: 'Forjado' })
  )
  await assertFails(
    updateDoc(doc(owner, 'publicProfiles/showcase-owner'), {
      avatarPath: 'profileAvatars/showcase-owner/forged.webp',
    })
  )
})

test('reports are private to reporter and superadmin', async () => {
  await assertSucceeds(getDoc(doc(outsider, 'showcaseReports/report_rules_v1')))
  await assertSucceeds(getDoc(doc(admin, 'showcaseReports/report_rules_v1')))
  await assertFails(getDoc(doc(owner, 'showcaseReports/report_rules_v1')))
})

test('storefront legal policy is public but acceptance is private and server-only', async () => {
  await assertSucceeds(getDoc(doc(anonymous, 'showcaseLegalPolicy/current')))
  await assertSucceeds(getDoc(doc(anonymous, 'showcaseLegalVersions/1.0.0')))
  await assertSucceeds(getDoc(doc(owner, 'users/showcase-owner/showcaseLegalAcceptances/1.0.0')))
  await assertSucceeds(getDoc(doc(admin, 'users/showcase-owner/showcaseLegalAcceptances/1.0.0')))
  await assertFails(getDoc(doc(outsider, 'users/showcase-owner/showcaseLegalAcceptances/1.0.0')))
  await assertFails(
    setDoc(doc(owner, 'users/showcase-owner/showcaseLegalAcceptances/forged'), {
      acceptedAt: new Date(),
    })
  )
})
