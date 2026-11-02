// Publica um documento comercial APROVADO (Condições do EvoCash, Termos de Publicidade e
// Impulsionamento, Termos das Vitrines, Política de Cancelamento e Reembolsos) no registro
// imutável legal_document_versions/legal_document_policy (20261212000002).
//
// - Arquivo com "approved": false (minuta) é recusado aqui e no banco.
// - O digest é calculado pelo servidor; mesma versão com outro texto falha.
// - Publicar exige --publish E CONFIRM_LEGAL_DOCUMENT=<documentId>@<version>.
// - Publicar NÃO habilita vendas: os gates comerciais continuam desligados até decisão própria.
//
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//      node scripts/publish-legal-document.mjs legal/commercial/evocash-terms.json [--publish]
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const ALLOWED_DOCUMENTS = [
  'evocash-terms',
  'advertising-terms',
  'showcase-publication-terms',
  'cancellation-refund-policy',
]

export function planDocumentPublication(content, { publish, confirmation }) {
  if (!content || typeof content !== 'object') throw new Error('LEGAL_VERSION_INVALID')
  if (!ALLOWED_DOCUMENTS.includes(content.documentId)) throw new Error('LEGAL_DOCUMENT_UNKNOWN')
  if (!/^\d+\.\d+\.\d+$/.test(String(content.version || ''))) throw new Error('LEGAL_VERSION_INVALID')
  if (content.approved !== true) throw new Error('LEGAL_DRAFT_NOT_PUBLISHABLE')
  const id = `${content.documentId}@${content.version}`
  if (publish && confirmation !== id) throw new Error('LEGAL_PUBLICATION_NOT_CONFIRMED')
  return { id, publish: Boolean(publish) }
}

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('Informe o arquivo JSON do documento.')
  const content = JSON.parse(readFileSync(resolve(file), 'utf8'))
  const plan = planDocumentPublication(content, {
    publish: process.argv.includes('--publish'),
    confirmation: process.env.CONFIRM_LEGAL_DOCUMENT,
  })
  if (!plan.publish) {
    console.log(`${plan.id} validado. Nada publicado (use --publish e CONFIRM_LEGAL_DOCUMENT=${plan.id}).`)
    return
  }
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
  const { data, error } = await createClient(url, key).rpc('admin_publish_legal_document', {
    p_content: content,
  })
  if (error) throw error
  console.log(`Publicado: ${JSON.stringify(data)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
