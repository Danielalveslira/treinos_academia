import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// privatePaymentConfig/pix (administração de chaves PIX, /admin/pagamentos) é
// server-only por design: allow read, write: if false SEM EXCEÇÃO, nem para superadmin
// via client SDK -- todo o CRUD passa só pela Admin SDK (ver
// pix-payment-admin-service.js). Este arquivo prova exatamente essa garantia, mesmo
// padrão de admin-rules.test.mjs.
let env
before(async () => {
  process.env.GCLOUD_PROJECT = 'demo-pix-payment-rules'
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  env = await initializeTestEnvironment({
    projectId: 'demo-pix-payment-rules',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users/admin1'), { role: 'superadmin' })
    await setDoc(doc(db, 'users/alice'), { role: 'user' })
    await setDoc(doc(db, 'privatePaymentConfig/pix'), {
      enabled: true,
      activeMethodId: 'pix_a',
      methods: { pix_a: { key: 'chave@evolutus.app', keyType: 'email', recipientName: 'Evolutus Ltda' } },
    })
  })
})
after(async () => {
  if (env) await env.cleanup()
})

test('usuário comum não consegue ler a configuração privada de PIX', async () => {
  const db = env.authenticatedContext('alice').firestore()
  await assertFails(getDoc(doc(db, 'privatePaymentConfig/pix')))
})

test('usuário comum não consegue escrever na configuração privada de PIX', async () => {
  const db = env.authenticatedContext('alice').firestore()
  await assertFails(setDoc(doc(db, 'privatePaymentConfig/pix'), { enabled: false }, { merge: true }))
})

test('mesmo um superadmin não consegue ler a configuração privada de PIX via client SDK -- só a Admin SDK pode', async () => {
  const db = env.authenticatedContext('admin1').firestore()
  await assertFails(getDoc(doc(db, 'privatePaymentConfig/pix')))
})

test('mesmo um superadmin não consegue escrever na configuração privada de PIX via client SDK', async () => {
  const db = env.authenticatedContext('admin1').firestore()
  await assertFails(setDoc(doc(db, 'privatePaymentConfig/pix'), { enabled: false }, { merge: true }))
})

test('um usuário não autenticado também não consegue ler a configuração privada de PIX', async () => {
  const db = env.unauthenticatedContext().firestore()
  await assertFails(getDoc(doc(db, 'privatePaymentConfig/pix')))
})
