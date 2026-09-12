import { before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, addDoc, collection, Timestamp, serverTimestamp } from 'firebase/firestore'
import { legalDigest } from '../functions/legal-core.js'

// Cobertura mínima e focada, não uma suíte completa de canCreateStatus() (que hoje não
// tem teste de regras dedicado): confirma só o elo final de que o achado #3 da auditoria
// de segurança depende -- uma accountRestrictions/{uid} com temporary_suspension (o que
// rate-limit-service.js grava quando RATE_LIMIT_ENFORCE=true) bloqueia de fato a próxima
// criação de status, via statusAccountOk() em firestore.rules. A escrita em si é feita
// aqui com withSecurityRulesDisabled, simulando o que o gatilho (Admin SDK) faria -- o
// teste é sobre o lado de leitura da regra, não sobre o gatilho.

let env
let member

function textStatus(overrides = {}) {
  return {
    communityId: 'comm1',
    authorId: 'member',
    authorUsername: null,
    authorIsSuperAdmin: false,
    type: 'text',
    text: 'Bora treinar',
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 1440 * 60000),
    ...overrides,
  }
}

before(async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../functions/legal/manifest.json', import.meta.url))
  )
  const legalDocuments = JSON.parse(
    await readFile(new URL('../functions/legal/documents.json', import.meta.url))
  )
  const digest = legalDigest(manifest, legalDocuments)

  env = await initializeTestEnvironment({
    projectId: 'demo-treinos',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
  await env.clearFirestore()
  member = env.authenticatedContext('member').firestore()

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'legalPolicy/current'), {
      version: manifest.version,
      published: true,
      digest,
      publishedAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'users/member'), {
      role: 'user',
      createdAt: Timestamp.fromMillis(1577836800000),
      legalAcceptance: { version: manifest.version, digest, acceptedAt: Timestamp.now() },
    })
    await setDoc(doc(db, 'communities/comm1'), {
      name: 'Comunidade',
      isActive: true,
      postAccess: 'everyone',
      createdBy: 'member',
      createdAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'communityMembers/comm1_member'), {
      communityId: 'comm1',
      userId: 'member',
      joinedAt: Timestamp.now(),
    })
  })
})

test('a member in good standing can create a status', async () => {
  await assertSucceeds(addDoc(collection(member, 'statuses'), textStatus()))
})

test('an automated temporary_suspension (same shape rate-limit-service.js writes) blocks the next status', async () => {
  const until = Timestamp.fromMillis(Date.now() + 30 * 60000)
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'accountRestrictions/member'), {
      action: 'temporary_suspension',
      until,
      decisionId: 'auto-decision-1',
    })
  })
  await assertFails(addDoc(collection(member, 'statuses'), textStatus()))
})

test('once the suspension expires (until in the past), status creation is allowed again', async () => {
  const until = Timestamp.fromMillis(Date.now() - 1000)
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'accountRestrictions/member'), {
      action: 'temporary_suspension',
      until,
      decisionId: 'auto-decision-1',
    })
  })
  await assertSucceeds(addDoc(collection(member, 'statuses'), textStatus()))
})
