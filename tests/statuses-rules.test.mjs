import { before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import {
  doc,
  setDoc,
  addDoc,
  updateDoc,
  collection,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore'
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

function pollStatus(overrides = {}) {
  return {
    communityId: 'comm1',
    authorId: 'member',
    authorUsername: null,
    authorIsSuperAdmin: false,
    type: 'poll',
    poll: {
      question: 'Treino hoje?',
      options: [
        { id: 'yes', label: 'Sim' },
        { id: 'no', label: 'Não' },
      ],
    },
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

// AUD-005: antes desta mudança, isValidStatusContent só validava o formato do campo
// de conteúdo esperado (data.text, data.poll, ...) sem travar as chaves de nível
// superior do documento -- um payload podia carregar campos extras arbitrários (ou
// até o conteúdo de outro tipo, ex.: 'poll' junto de type == 'text') e passar.
test('a status cannot carry fields outside the schema for its type', async () => {
  await assertFails(
    addDoc(collection(member, 'statuses'), { ...textStatus(), extraField: 'not allowed' })
  )
  await assertFails(
    addDoc(collection(member, 'statuses'), {
      ...textStatus(),
      poll: { question: 'q', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    })
  )
})

test('a poll status cannot carry an unrelated text field', async () => {
  await assertFails(addDoc(collection(member, 'statuses'), { ...pollStatus(), text: 'sneaky' }))
})

// AUD-003/AUD-004: authorUsername não era travado na lista de campos imutáveis do
// update, e o conteúdo (texto/enquete/etc.) de uma publicação já existente podia ser
// reescrito via acesso direto ao Firestore -- o app nunca chama update() no documento
// de status (só create/delete), então bloquear por completo não quebra nada real.
test('a status document can never be updated after creation, not even by its own author', async () => {
  const ref = await addDoc(collection(member, 'statuses'), textStatus())
  await assertFails(updateDoc(ref, { authorUsername: 'someone-else' }))
  await assertFails(updateDoc(ref, { text: 'edited after votes came in' }))
})

// AUD-011: optionId só era validado como string, nunca conferido contra as opções
// reais da enquete -- um cliente podia gravar um voto com um id inventado.
test('voting on a poll requires optionId to match one of its real options', async () => {
  const ref = await addDoc(collection(member, 'statuses'), pollStatus())
  await assertFails(
    setDoc(doc(member, `statuses/${ref.id}/votes/member`), {
      userId: 'member',
      optionId: 'made-up-option',
      createdAt: serverTimestamp(),
    })
  )
  await assertSucceeds(
    setDoc(doc(member, `statuses/${ref.id}/votes/member`), {
      userId: 'member',
      optionId: 'yes',
      createdAt: serverTimestamp(),
    })
  )
})
