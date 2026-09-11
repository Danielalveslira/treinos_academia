import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
  serverTimestamp,
  Timestamp as WebTimestamp,
} from 'firebase/firestore'
import { createDeletionService } from '../functions/deletion-service.js'
import { createAccountsService } from '../functions/accounts-service.js'
import { createBumpMemberCount } from '../functions/community-members-service.js'
import { legalDigest } from '../functions/legal-core.js'

let env,
  db,
  client,
  adminClient,
  api,
  FieldValue,
  Timestamp,
  FieldPath,
  HttpsError,
  deletion,
  authCalls,
  bucketDeletes
before(async () => {
  process.env.GCLOUD_PROJECT = 'demo-admin-rules'
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  env = await initializeTestEnvironment({
    projectId: 'demo-admin-rules',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
  await env.clearFirestore()
  api = await import('../functions/index.js')
  const require = createRequire(new URL('../functions/package.json', import.meta.url))
  const admin = require('firebase-admin/firestore')
  ;({ FieldValue, Timestamp, FieldPath } = admin)
  db = admin.getFirestore()
  ;({ HttpsError } = require('firebase-functions/v2/https'))
  await db.doc('users/admin').set({ role: 'superadmin' })
  await db.doc('users/owner').set({ role: 'user', username: 'owner', createdAt: Timestamp.now() })
  await db.doc('maintenance/adminV1').set({ interactionsVersion: 1 })
  // email_verified: true -- este é o usuário genérico usado por praticamente todo o
  // arquivo, para features que não têm nada a ver com verificação de e-mail (o teste
  // dedicado a essa regra fica em profile-rules.test.mjs). Sem isso, criar/atualizar
  // owner com Timestamp.now() (linha acima) o deixaria sempre "depois do corte" e sem
  // token verificado, quebrando testes que não têm relação nenhuma com esse assunto.
  client = env.authenticatedContext('owner', { email_verified: true }).firestore()
  adminClient = env.authenticatedContext('admin').firestore()
  authCalls = []
  bucketDeletes = []
  deletion = createDeletionService({
    db,
    FieldValue,
    Timestamp,
    HttpsError,
    auth: {
      updateUser: async (id) => authCalls.push(['disable', id]),
      revokeRefreshTokens: async (id) => authCalls.push(['revoke', id]),
      deleteUser: async (id) => authCalls.push(['delete', id]),
    },
    bucket: {
      file: (path) => ({
        delete: async () => {
          bucketDeletes.push(path)
        },
      }),
    },
  })
})
after(async () => {
  await db?.terminate()
  await env?.cleanup()
})

test('profile rules prevent administrative identity injection and creation-date removal', async () => {
  await assertFails(updateDoc(doc(client, 'users/owner'), { id: 'another' }))
  await assertFails(updateDoc(doc(client, 'users/owner'), { createdAt: deleteField() }))
  await assertFails(updateDoc(doc(client, 'users/owner'), { accountStatus: 'active' }))
  await assertSucceeds(updateDoc(doc(client, 'users/owner'), { bio: 'Meu perfil' }))
  const fresh = env.authenticatedContext('new').firestore()
  await assertFails(
    setDoc(doc(fresh, 'users/new'), { role: 'user', id: 'other', createdAt: serverTimestamp() })
  )
  await assertFails(setDoc(doc(fresh, 'users/new'), { role: 'user' }))
  await assertSucceeds(
    setDoc(doc(fresh, 'users/new'), {
      role: 'user',
      createdAt: serverTimestamp(),
      publicProfileVersion: 1,
    })
  )
})

test('sexo/dataNascimento are validated on write, optional, and never require re-sending them together', async () => {
  const fresh = env.authenticatedContext('withbirth').firestore()
  await assertSucceeds(
    setDoc(doc(fresh, 'users/withbirth'), {
      role: 'user',
      createdAt: serverTimestamp(),
      publicProfileVersion: 1,
    })
  )
  // Formato: só os três valores aceitos para sexo, e dataNascimento precisa ser um
  // timestamp plausível (nunca no futuro, nunca implausivelmente antigo).
  await assertFails(updateDoc(doc(fresh, 'users/withbirth'), { sexo: 'outro' }))
  await assertFails(
    updateDoc(doc(fresh, 'users/withbirth'), {
      dataNascimento: WebTimestamp.fromMillis(Date.now() + 86400000),
    })
  )
  await assertFails(
    updateDoc(doc(fresh, 'users/withbirth'), {
      dataNascimento: WebTimestamp.fromDate(new Date('1850-01-01')),
    })
  )
  await assertSucceeds(
    updateDoc(doc(fresh, 'users/withbirth'), {
      sexo: 'feminino',
      dataNascimento: WebTimestamp.fromDate(new Date('2000-06-15T12:00:00')),
    })
  )
  // Editar outro campo depois não exige reenviar sexo/dataNascimento — igual a
  // username/bio, eles só são revalidados quando o próprio write os toca.
  await assertSucceeds(updateDoc(doc(fresh, 'users/withbirth'), { bio: 'oi' }))

  // Conta antiga, sem os dois campos (nunca existiram): compatível, sem nenhuma
  // migração — mesmo raciocínio de qualquer campo opcional adicionado depois.
  const legacy = env.authenticatedContext('legacybirth').firestore()
  await assertSucceeds(
    setDoc(doc(legacy, 'users/legacybirth'), {
      role: 'user',
      createdAt: serverTimestamp(),
      publicProfileVersion: 1,
    })
  )
  await assertSucceeds(getDoc(doc(legacy, 'users/legacybirth')))
})

test('acceptLegalDocuments verifies the minimum age from dataNascimento on the server, never trusting a client-sent flag', async () => {
  const legalRequire = createRequire(new URL('../functions/package.json', import.meta.url))
  const manifest = legalRequire('./legal/manifest.json')
  const documents = legalRequire('./legal/documents.json')
  const digest = legalDigest(manifest, documents)
  // legalPolicy/current publicado ativa o ramo caro de hasCurrentAcceptance() nas
  // regras (ver firestore.rules) para o resto deste arquivo, que compartilha o mesmo
  // db/env entre todos os testes — precisa ser desfeito no final, senão os testes
  // seguintes (cujos usuários não têm legalAcceptance) passam a falhar por causa
  // disto, não do que eles realmente testam.
  await db.doc('legalPolicy/current').set({ version: manifest.version, digest, published: true })
  try {
    const req = (uid) => ({
      auth: { uid },
      rawRequest: { ip: '203.0.113.10' },
      data: { version: manifest.version, accepted: true, healthDataConsent: true },
    })

    // Conta anterior a este campo: sem dataNascimento nenhuma.
    await db.doc('users/nobirth').set({ role: 'user' })
    await assert.rejects(
      api.acceptLegalDocuments.run(req('nobirth')),
      (error) => error.code === 'failed-precondition'
    )

    // Abaixo da idade mínima do manifesto — nunca um "ageConfirmed" enviado pelo
    // cliente, sempre a data já gravada no próprio documento.
    const under18 = new Date()
    under18.setFullYear(under18.getFullYear() - (manifest.minimumAge - 1))
    await db.doc('users/under18').set({ role: 'user', dataNascimento: Timestamp.fromDate(under18) })
    await assert.rejects(
      api.acceptLegalDocuments.run(req('under18')),
      (error) => error.code === 'failed-precondition'
    )

    // Idade suficiente: aceita normalmente.
    const adult = new Date()
    adult.setFullYear(adult.getFullYear() - (manifest.minimumAge + 5))
    await db.doc('users/adult').set({ role: 'user', dataNascimento: Timestamp.fromDate(adult) })
    await assert.doesNotReject(api.acceptLegalDocuments.run(req('adult')))
  } finally {
    await db.doc('legalPolicy/current').delete()
  }
})

test('account listing uses one Auth batch per page and includes profiles missing createdAt', async () => {
  const batch = db.batch()
  for (let i = 0; i < 56; i++)
    batch.set(db.doc(`users/page${String(i).padStart(3, '0')}`), {
      role: 'user',
      username: 'page',
      id: 'spoofed',
    })
  await batch.commit()
  let batchCalls = 0
  const service = createAccountsService({
    db,
    FieldPath,
    HttpsError,
    auth: {
      getUser: async () => {
        throw Object.assign(new Error(), { code: 'auth/user-not-found' })
      },
      getUsers: async (ids) => {
        batchCalls++
        assert.ok(ids.length <= 50)
        return { users: ids.map(({ uid }) => ({ uid, email: `${uid}@example.com` })) }
      },
    },
  })
  const first = await service({ search: '@page' })
  assert.equal(first.accounts.length, 50)
  assert.equal(first.accounts[0].id, 'page000')
  const second = await service({ search: '@page', cursor: first.nextCursor })
  assert.equal(second.accounts.length, 6)
  assert.equal(second.nextCursor, null)
  assert.equal(batchCalls, 2)
  await assert.rejects(service({ pageSize: 500 }))
})

async function drain(ref) {
  for (let i = 0; i < 30; i++) {
    if ((await ref.get()).data().state === 'complete') return
    await deletion.step(ref)
  }
  assert.fail('job did not complete')
}

test('account deletion fences writes, drains bounded batches and cleans foreign interactions', async () => {
  const batch = db.batch()
  batch.set(db.doc('users/erase'), { role: 'user', username: 'erase' })
  for (let i = 0; i < 205; i++) batch.set(db.doc(`users/erase/workouts/${i}`), { weight: 1 })
  for (const path of [
    'communityMembers/gym_erase',
    'communityRestrictions/gym_erase',
    'statuses/foreign/votes/erase',
    'statuses/foreign/participants/erase',
  ])
    batch.set(db.doc(path), { userId: 'erase' })
  batch.set(db.doc('statuses/own'), { authorId: 'erase' })
  batch.set(db.doc('statuses/own/votes/another'), { userId: 'another' })
  batch.set(db.doc('usernames/erase'), { uid: 'erase' })
  await batch.commit()
  await deletion.queue('account', 'erase', 'admin')
  const ref = db.doc('deletionJobs/account_erase')
  const erasedClient = env.authenticatedContext('erase').firestore()
  await assertFails(updateDoc(doc(erasedClient, 'users/erase'), { bio: 'race' }))
  await assert.rejects(
    api.setAccountStatus.run({
      auth: { uid: 'admin' },
      data: { userId: 'erase', disabled: true, reason: 'racing the deletion job' },
    }),
    (error) => error.code === 'failed-precondition'
  )
  await drain(ref)
  await drain(db.doc('deletionJobs/status_own'))
  assert.equal((await db.doc('users/erase').get()).exists, false)
  assert.equal((await db.collection('users/erase/workouts').get()).size, 0)
  assert.equal((await db.doc('statuses/foreign/votes/erase').get()).exists, false)
  assert.equal((await db.doc('statuses/own/votes/another').get()).exists, false)
  assert.equal((await db.doc('communityRestrictions/gym_erase').get()).exists, false)
  await assertFails(
    setDoc(doc(erasedClient, 'users/erase'), { role: 'user', createdAt: serverTimestamp() })
  )
  await deletion.queue('account', 'erase', 'admin')
  assert.deepEqual(
    authCalls.filter(([, id]) => id === 'erase').map(([op]) => op),
    ['disable', 'revoke', 'delete']
  )
})

test('account deletion carries photoPath into the status cleanup job it creates, so the file is not orphaned', async () => {
  await db.doc('users/photoowner').set({ role: 'user' })
  await db.doc('statuses/photopost').set({
    authorId: 'photoowner',
    type: 'photo',
    photoPath: 'statusPhotos/gym/photopost.webp',
  })
  await deletion.queue('account', 'photoowner', 'admin')
  await drain(db.doc('deletionJobs/account_photoowner'))
  // The job removeStatuses() creates must already carry photoPath — the deletion
  // trigger that would otherwise supply it finds the job pre-existing and gives up
  // (queueDeleted only creates when absent), so this is the only chance to set it.
  const statusJob = await db.doc('deletionJobs/status_photopost').get()
  assert.equal(statusJob.data().photoPath, 'statusPhotos/gym/photopost.webp')
  await drain(statusJob.ref)
  assert.deepEqual(bucketDeletes, ['statusPhotos/gym/photopost.webp'])
})

test('failed Auth deletion can resume after a missing profile; concurrent workers do not advance twice', async () => {
  await db.doc('users/retry').set({ role: 'user' })
  await deletion.queue('account', 'retry', 'admin')
  let fail = true
  let calls = 0
  const service = createDeletionService({
    db,
    FieldValue,
    Timestamp,
    HttpsError,
    auth: {
      updateUser: async () => {},
      revokeRefreshTokens: async () => {},
      deleteUser: async () => {
        calls++
        if (fail) throw Object.assign(new Error('transient'), { code: 'auth/internal-error' })
      },
    },
  })
  const ref = db.doc('deletionJobs/account_retry')
  await assert.rejects(service.step(ref))
  await db.doc('users/retry').delete()
  await service.queue('account', 'retry', 'admin')
  fail = false
  await Promise.all([service.step(ref), service.step(ref)])
  assert.equal((await ref.get()).data().state, 'complete')
  assert.equal(calls, 2)
})

test('community deletion cleans memberships, restrictions and nested status data', async () => {
  await db.doc('communities/removegym').set({ isActive: true })
  await db
    .doc('communityMembers/removegym_owner')
    .set({ communityId: 'removegym', userId: 'owner' })
  await db
    .doc('communityRestrictions/removegym_other')
    .set({ communityId: 'removegym', userId: 'other' })
  await db.doc('statuses/gympost').set({ communityId: 'removegym' })
  await db.doc('statuses/gympost/participants/owner').set({ userId: 'owner' })
  await deletion.queue('community', 'removegym', 'admin')
  await drain(db.doc('deletionJobs/community_removegym'))
  await drain(db.doc('deletionJobs/status_gympost'))
  for (const path of [
    'communities/removegym',
    'communityMembers/removegym_owner',
    'communityRestrictions/removegym_other',
    'statuses/gympost/participants/owner',
  ])
    assert.equal((await db.doc(path).get()).exists, false)
})

test('bumping the member count of a community without one yet counts for real, not from an assumed zero', async () => {
  const bumpMemberCount = createBumpMemberCount({ db, FieldValue })
  // Comunidade "antiga": já tem membros de verdade, mas nunca foi tocada por este
  // gatilho, então memberCount nunca foi inicializado — exatamente o estado real de
  // qualquer comunidade criada antes desse campo existir.
  await db.doc('communities/oldgym').set({ isActive: true })
  await db.doc('communityMembers/oldgym_a').set({ communityId: 'oldgym', userId: 'a' })
  await db.doc('communityMembers/oldgym_b').set({ communityId: 'oldgym', userId: 'b' })
  // O gatilho só roda depois que o documento já existe (onDocumentCreated) — simula
  // isso criando o terceiro membro antes de chamar bumpMemberCount, como já teria
  // acontecido de verdade.
  await db.doc('communityMembers/oldgym_c').set({ communityId: 'oldgym', userId: 'c' })
  await bumpMemberCount('oldgym', 1)
  // Incrementar de um "0" assumido daria 1 (a antiga falha) — o total real é 3.
  assert.equal((await db.doc('communities/oldgym').get()).data().memberCount, 3)

  // Uma vez inicializado, chamadas seguintes voltam a ser incrementos simples.
  await db.doc('communityMembers/oldgym_d').set({ communityId: 'oldgym', userId: 'd' })
  await bumpMemberCount('oldgym', 1)
  assert.equal((await db.doc('communities/oldgym').get()).data().memberCount, 4)
  await db.doc('communityMembers/oldgym_d').delete()
  await bumpMemberCount('oldgym', -1)
  assert.equal((await db.doc('communities/oldgym').get()).data().memberCount, 3)

  // Comunidade já excluída (corrida com cleanupDeletedCommunity): não deve lançar.
  await assert.doesNotReject(bumpMemberCount('does-not-exist', 1))
})

test('votes and participation require immutable owner attribution for indexed cleanup', async () => {
  await db.doc('communities/votegym').set({ isActive: true })
  await db.doc('communityMembers/votegym_owner').set({ userId: 'owner', communityId: 'votegym' })
  await db.doc('statuses/poll').set({
    communityId: 'votegym',
    type: 'poll',
    expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
  })
  await assertFails(
    setDoc(doc(client, 'statuses/poll/votes/owner'), {
      userId: 'another',
      optionId: '0',
      createdAt: WebTimestamp.now(),
    })
  )
  await assertSucceeds(
    setDoc(doc(client, 'statuses/poll/votes/owner'), {
      userId: 'owner',
      optionId: '0',
      createdAt: WebTimestamp.now(),
    })
  )
})

test('legacy migration is read-only by default, attributes ownership and queues old orphan cleanup', async () => {
  const { migrateAdmin } = await import('../functions/admin-migration.js')
  await db.doc('statuses/legacy-orphan/votes/legacy-user').set({ optionId: '0' })
  await db
    .doc('communityMembers/legacy-gym_owner')
    .set({ communityId: 'legacy-gym', userId: 'owner' })
  const dry = await migrateAdmin({ db, FieldPath, FieldValue })
  assert.ok(dry.interactions >= 1)
  assert.ok(dry.cleanupJobs >= 1)
  assert.equal(
    (await db.doc('statuses/legacy-orphan/votes/legacy-user').get()).data().userId,
    undefined
  )
  assert.equal((await db.doc('deletionJobs/community_legacy-gym').get()).exists, false)
  await migrateAdmin({ db, FieldPath, FieldValue, apply: true })
  assert.equal(
    (await db.doc('statuses/legacy-orphan/votes/legacy-user').get()).data().userId,
    'legacy-user'
  )
  assert.equal((await db.doc('deletionJobs/community_legacy-gym').get()).exists, true)
  assert.equal((await db.doc('maintenance/adminV1').get()).data().interactionsVersion, 1)
  const repeated = await migrateAdmin({ db, FieldPath, FieldValue, apply: true })
  assert.equal(repeated.interactions, 0)
  assert.equal(repeated.cleanupJobs, 0)
})
