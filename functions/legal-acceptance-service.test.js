import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeApp, getApps } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createLegalAcceptanceService } from './legal-acceptance-service.js'
import { APPROVED_LEGAL_DIGESTS, legalDigest } from './legal-core.js'

globalThis.process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
if (getApps().length === 0) initializeApp({ projectId: 'demo-legal-acceptance-test' })
const db = getFirestore()
class HttpsError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
const assertWritableAccount = async (tx, uid) => {
  if ((await tx.get(db.doc(`deletionJobs/account_${uid}`))).exists) {
    throw new HttpsError('failed-precondition', 'A conta está em exclusão.')
  }
}
const service = createLegalAcceptanceService({ db, FieldValue, HttpsError, assertWritableAccount })
const previousArchive = JSON.parse(
  readFileSync(new URL('./legal/test-fixtures/1.3.0.json', import.meta.url))
)
const currentArchive = {
  manifest: JSON.parse(readFileSync(new URL('./legal/manifest.json', import.meta.url))),
  documents: JSON.parse(readFileSync(new URL('./legal/documents.json', import.meta.url))),
}
currentArchive.digest = legalDigest(currentArchive.manifest, currentArchive.documents)
const archives = { '1.3.0': previousArchive, '1.4.0': currentArchive }
let sequence = 0
const unique = () => `legal_user_${Date.now()}_${sequence++}`

async function seedPolicy(version, archive = archives[version]) {
  await Promise.all([
    db.doc(`legalVersions/${version}`).set(archive),
    db.doc('legalPolicy/current').set({
      version,
      digest: APPROVED_LEGAL_DIGESTS[version],
      published: true,
    }),
  ])
}

async function seedUser(uid, birthDate = new Date(1990, 0, 1)) {
  await db.doc(`users/${uid}`).set({
    role: 'user',
    dataNascimento: Timestamp.fromDate(birthDate),
  })
}

const consent = (version) => ({
  version,
  digest: APPROVED_LEGAL_DIGESTS[version],
  accepted: true,
  healthDataConsent: true,
})

test('accepts exactly the active archived version and requires a fresh 1.4.0 acceptance after transition', async () => {
  const uid = unique()
  await seedUser(uid)
  await seedPolicy('1.3.0')
  assert.equal((await service.accept(uid, consent('1.3.0'), '203.0.113.1')).version, '1.3.0')

  await seedPolicy('1.4.0')
  assert.equal((await service.accept(uid, consent('1.4.0'), '203.0.113.1')).version, '1.4.0')
  assert.equal((await db.doc(`users/${uid}/legalAcceptances/1.3.0`).get()).data().version, '1.3.0')
  assert.equal((await db.doc(`users/${uid}/legalAcceptances/1.4.0`).get()).data().digest, consent('1.4.0').digest)
  assert.equal((await db.doc(`users/${uid}`).get()).data().legalAcceptance.version, '1.4.0')
})

test('replays are idempotent; unsupported versions and forged or altered digests are rejected', async () => {
  const uid = unique()
  await seedUser(uid)
  await seedPolicy('1.3.0')
  await service.accept(uid, consent('1.3.0'), '203.0.113.2')
  assert.equal((await service.accept(uid, consent('1.3.0'), '203.0.113.2')).repeated, true)
  await assert.rejects(
    service.accept(uid, { ...consent('1.3.0'), version: '9.9.9' }, '203.0.113.2'),
    (error) => error.code === 'failed-precondition'
  )
  await assert.rejects(
    service.accept(uid, { ...consent('1.3.0'), digest: 'forged' }, '203.0.113.2'),
    (error) => error.code === 'failed-precondition'
  )
  const changedArchive = {
    ...previousArchive,
    documents: [{ ...previousArchive.documents[0], title: 'Conteúdo alterado' }],
  }
  await db.doc('legalVersions/1.3.0').set(changedArchive)
  const newUid = unique()
  await seedUser(newUid)
  await assert.rejects(
    service.accept(newUid, consent('1.3.0'), '203.0.113.2'),
    (error) => error.code === 'failed-precondition'
  )
})

test('concurrent identical accepts create one record and safely replay the transaction', async () => {
  const uid = unique()
  await seedUser(uid)
  await seedPolicy('1.4.0')
  const results = await Promise.all([
    service.accept(uid, consent('1.4.0'), '203.0.113.4'),
    service.accept(uid, consent('1.4.0'), '203.0.113.4'),
  ])
  assert.equal(results.filter((result) => result.repeated).length, 1)
  assert.equal((await db.doc(`users/${uid}/legalAcceptances/1.4.0`).get()).exists, true)
})

test('preserves required consent, age checks and the account-deletion write fence', async () => {
  const uid = unique()
  await seedUser(uid)
  await seedPolicy('1.4.0')
  await assert.rejects(
    service.accept(uid, { ...consent('1.4.0'), healthDataConsent: false }, '203.0.113.3'),
    (error) => error.code === 'failed-precondition'
  )
  const underage = unique()
  await seedUser(underage, new Date(new Date().getFullYear() - 11, 0, 1))
  await assert.rejects(
    service.accept(underage, consent('1.4.0'), '203.0.113.3'),
    (error) => error.code === 'failed-precondition'
  )
  const deleting = unique()
  await seedUser(deleting)
  await db.doc(`deletionJobs/account_${deleting}`).set({ state: 'complete' })
  await assert.rejects(
    service.accept(deleting, consent('1.4.0'), '203.0.113.3'),
    (error) => error.message === 'A conta está em exclusão.'
  )
})
