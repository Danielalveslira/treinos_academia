import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldPath, FieldValue } from 'firebase-admin/firestore'
import { migrateAdmin } from './admin-migration.js'

// Explicit maintenance command; never runs during deployment or imports.
// node functions/migrate-admin.js --project PROJECT_ID [--apply]
const projectIndex = process.argv.indexOf('--project')
const projectId = process.argv[projectIndex + 1]
if (projectIndex < 0 || !projectId || projectId.startsWith('--'))
  throw new Error('Informe --project PROJECT_ID')
const apply = process.argv.includes('--apply')
initializeApp({ projectId })
const db = getFirestore()
try {
  const counts = await migrateAdmin({ db, FieldPath, FieldValue, apply })
  console.log(JSON.stringify({ projectId, mode: apply ? 'apply' : 'dry-run', ...counts }))
} finally {
  await db.terminate()
}
