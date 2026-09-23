// Executar somente após aprovação expressa da minuta e revisão jurídica, usando
// credenciais administrativas do projeto correto. Este script não é chamado por deploy.
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { legalDigest } from './legal-core.js'

const manifest = JSON.parse(
  readFileSync(new URL('./legal/showcase-manifest.json', import.meta.url))
)
const document = JSON.parse(
  readFileSync(new URL('./legal/showcase-document.json', import.meta.url))
)
if (!manifest.published || manifest.documentId !== document.id || manifest.version.length > 64) {
  throw new Error(
    'A minuta da Vitrine precisa estar aprovada, consistente e marcada como published antes da ativação.'
  )
}

initializeApp()
const db = getFirestore()
const digest = legalDigest(manifest, [document])
await db.runTransaction(async (tx) => {
  const archiveRef = db.doc(`showcaseLegalVersions/${manifest.version}`)
  const existing = await tx.get(archiveRef)
  if (existing.exists && existing.data().digest !== digest) {
    throw new Error('Esta versão já existe com outro conteúdo. Crie uma nova versão.')
  }
  if (!existing.exists) {
    tx.create(archiveRef, {
      manifest,
      document,
      digest,
      createdAt: FieldValue.serverTimestamp(),
    })
  }
  tx.set(db.doc('showcaseLegalPolicy/current'), {
    documentId: manifest.documentId,
    version: manifest.version,
    published: true,
    digest,
    publishedAt: FieldValue.serverTimestamp(),
  })
})

console.log(`Termos da Vitrine ${manifest.version} ativados.`)
