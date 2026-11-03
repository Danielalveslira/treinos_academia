// Registra e (opcionalmente) ativa a versão dos documentos gerais (legal/manifest.json +
// legal/documents.json) em legal_versions/legal_policy. Usa o MESMO digest do cliente
// (sha256 de JSON.stringify({manifest, documents}), ver src/utils/legal.js).
//
// Garantias (20261212000001):
// - minuta (manifest.published !== true) nunca é registrada nem ativada;
// - o digest precisa constar de legal/approved-digests.json (o app publicado conhece a versão);
// - uma versão já registrada com outro conteúdo falha (histórico imutável no banco);
// - repetir com o mesmo conteúdo é idempotente;
// - ativar exige --activate E CONFIRM_LEGAL_ACTIVATION=<versão>. Sem isso, só registra
//   (a versão registrada e não ativada não é visível ao público).
//
// Ordem de release: publicar o frontend que já contém a nova versão em approved-digests.json,
// registrar, e só então ativar. Clientes com cache antigo veem "Documentos atualizados" e
// recarregam; a leitura dos documentos continua disponível durante a transição.
//
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-legal.mjs [--activate]
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

export function legalBundleDigest(manifest, documents) {
  return createHash('sha256').update(JSON.stringify({ manifest, documents })).digest('hex')
}

export function planLegalRelease({ manifest, documents, approvedDigests, activate, confirmation }) {
  if (manifest?.published !== true) throw new Error('LEGAL_DRAFT_NOT_PUBLISHABLE')
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) throw new Error('LEGAL_VERSION_INVALID')
  const digest = legalBundleDigest(manifest, documents)
  if (approvedDigests?.[manifest.version] !== digest) throw new Error('LEGAL_DIGEST_NOT_APPROVED_IN_APP')
  if (activate && confirmation !== manifest.version) throw new Error('LEGAL_ACTIVATION_NOT_CONFIRMED')
  return { version: manifest.version, digest, activate: Boolean(activate) }
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de rodar este script.')
    process.exit(1)
  }
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)))
  const manifest = read('../legal/manifest.json')
  const documents = read('../legal/documents.json')
  const plan = planLegalRelease({
    manifest,
    documents,
    approvedDigests: read('../legal/approved-digests.json'),
    activate: process.argv.includes('--activate'),
    confirmation: process.env.CONFIRM_LEGAL_ACTIVATION,
  })
  const supabase = createClient(url, serviceRoleKey)

  const { data: existing, error: readError } = await supabase
    .from('legal_versions')
    .select('version, digest')
    .eq('version', plan.version)
    .maybeSingle()
  if (readError) throw readError
  if (existing && existing.digest !== plan.digest) throw new Error('LEGAL_VERSION_IMMUTABLE')
  if (!existing) {
    const { error } = await supabase
      .from('legal_versions')
      .insert({ version: plan.version, manifest, documents, digest: plan.digest })
    if (error) throw error
  }
  console.log(`legal_versions registrado: version=${plan.version} digest=${plan.digest}`)
  if (!plan.activate) {
    console.log('Não ativado. Para ativar: --activate e CONFIRM_LEGAL_ACTIVATION=' + plan.version)
    return
  }
  const { data, error } = await supabase.rpc('admin_publish_legal_policy', {
    p_version: plan.version,
    p_digest: plan.digest,
  })
  if (error) throw error
  console.log(`legal_policy ativado: ${JSON.stringify(data)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
