// Publica os documentos legais atuais (functions/legal/manifest.json + documents.json)
// nas tabelas legal_policy/legal_versions do Supabase — equivalente ao antigo
// publish-legal.js, mas roda contra Postgres em vez do Firestore. Usa o MESMO
// algoritmo de digest de functions/legal-core.js (sha256 de JSON.stringify({manifest,
// documents})), então o valor calculado aqui bate com o que o cliente recalcula ao
// aceitar os termos (ver src/utils/legalDigest.js).
//
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-legal.mjs
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de rodar este script.')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(new URL('../functions/legal/manifest.json', import.meta.url)))
const documents = JSON.parse(readFileSync(new URL('../functions/legal/documents.json', import.meta.url)))
const digest = createHash('sha256').update(JSON.stringify({ manifest, documents })).digest('hex')

const supabase = createClient(url, serviceRoleKey)

const { error: versionError } = await supabase
  .from('legal_versions')
  .upsert({ version: manifest.version, manifest, documents, digest }, { onConflict: 'version' })
if (versionError) throw versionError

const { error: policyError } = await supabase.from('legal_policy').upsert({
  id: true,
  version: manifest.version,
  published: manifest.published,
  digest,
  minimum_age: manifest.minimumAge,
  published_at: new Date().toISOString(),
})
if (policyError) throw policyError

console.log(`legal_policy publicado: version=${manifest.version} digest=${digest}`)
