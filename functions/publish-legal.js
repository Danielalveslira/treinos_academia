// Executar somente após revisão jurídica e com credenciais administrativas do projeto correto.
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { legalDigest } from './legal-core.js'

const manifest = JSON.parse(readFileSync(new URL('./legal/manifest.json', import.meta.url)))
const documents = JSON.parse(readFileSync(new URL('./legal/documents.json', import.meta.url)))
if (
  !manifest.published ||
  !manifest.controllerName ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manifest.contactEmail)
) {
  throw new Error(
    'Revise e complete a identificação e contato, e marque published somente após aprovação jurídica.'
  )
}
initializeApp()
const db = getFirestore()
const digest = legalDigest(manifest, documents)
await db.runTransaction(async (tx) => {
  const ref = db.doc(`legalVersions/${manifest.version}`)
  const existing = await tx.get(ref)
  if (existing.exists && existing.data().digest !== digest)
    throw new Error('Esta versão já existe com outro conteúdo. Crie uma nova versão.')
  if (!existing.exists)
    tx.create(ref, { manifest, documents, digest, createdAt: FieldValue.serverTimestamp() })
  tx.set(db.doc('legalPolicy/current'), {
    version: manifest.version,
    published: true,
    digest,
    publishedAt: FieldValue.serverTimestamp(),
  })
})
console.log(`Versão ${manifest.version} ativada.`)
