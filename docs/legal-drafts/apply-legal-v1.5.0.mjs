#!/usr/bin/env node
// Aplica a versão legal 1.5.0 (Política de Privacidade) de forma reproduzível e verificável.
// Executar na raiz do repositório, por um operador autorizado, DEPOIS da aprovação jurídica:
//   node docs/legal-drafts/apply-legal-v1.5.0.mjs          (escreve os arquivos)
//   node docs/legal-drafts/apply-legal-v1.5.0.mjs --check  (só confere o estado atual)
//
// O que faz (nada é digitado à mão; o digest é CALCULADO com o mesmo algoritmo de src/utils/legalDigest.js):
//  1. arquiva a v1.4.0 EXATA (lida do commit HEAD) em legal/test-fixtures/1.4.0.json (imutável, como a 1.3.0);
//  2. troca só o bloco "privacy" de legal/documents.json (Termos e Regras ficam byte a byte iguais);
//  3. sobe legal/manifest.json para 1.5.0;
//  4. acrescenta o digest 1.5.0 em legal/approved-digests.json (a 1.4.0 e a 1.3.0 permanecem);
//  5. em src/utils/legal.js passa a mapear 1.3.0, 1.4.0 (fixture) e 1.5.0 (arquivos atuais).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const check = process.argv.includes('--check')
const read = (p) => readFileSync(p, 'utf8')
const json = (p) => JSON.parse(read(p))
const git = (args) => execFileSync('git', args, { encoding: 'utf8' })
const digestOf = (manifest, documents) => createHash('sha256').update(JSON.stringify({ manifest, documents })).digest('hex')

const DRAFT = json('docs/legal-drafts/documents.v1.5.0.draft.json')
const draftPrivacy = DRAFT.find((d) => d.id === 'privacy')

const headManifest = JSON.parse(git(['show', 'HEAD:legal/manifest.json']))
const headDocsText = git(['show', 'HEAD:legal/documents.json'])
const headDocs = JSON.parse(headDocsText)
if (headManifest.version !== '1.4.0') throw new Error(`HEAD não está na 1.4.0 (${headManifest.version}); abortando`)
const approved = json('legal/approved-digests.json')
if (digestOf(headManifest, headDocs) !== approved['1.4.0']) throw new Error('digest da 1.4.0 no HEAD não bate com approved-digests; abortando')

// 2. substitui só o bloco privacy, preservando o texto bruto dos demais (mesmo recuo do arquivo original)
const lines = headDocsText.split('\n')
const start = lines.findIndex((l) => l === '    "id": "privacy",') - 1 // linha "  {" que abre o bloco
let end = start
while (!/^  }[,]?$/.test(lines[end]) || end === start) end += 1
const block = JSON.stringify(draftPrivacy, null, 2).split('\n').map((l) => `  ${l}`).join('\n')
const newDocsText = [...lines.slice(0, start), block, ...lines.slice(end + 1)].join('\n')
const newDocs = JSON.parse(newDocsText)
for (const id of ['community', 'terms']) {
  if (JSON.stringify(newDocs.find((d) => d.id === id)) !== JSON.stringify(headDocs.find((d) => d.id === id))) throw new Error(`bloco ${id} divergiu`)
}

const newManifest = {
  version: '1.5.0',
  date: '2026-10-09',
  published: true,
  controllerName: headManifest.controllerName,
  contactEmail: headManifest.contactEmail,
  minimumAge: headManifest.minimumAge,
  changes: [
    'Política de Privacidade: explica a contagem de visualizações e cliques em anúncios patrocinados (totais por anúncio, posição, comunidade e dia; registro temporário de até 48 horas ligado à conta), a base legal (legítimo interesse), o direito de oposição e que menores de 18 anos ficam fora dessa contagem.',
    'Política de Privacidade: corrige os provedores (Supabase e Vercel, em vez de Google Firebase) e passa a citar a InfinitePay, as notificações push e os prazos de retenção dos dados técnicos.',
  ],
}
const newDigest = digestOf(newManifest, newDocs)

const fixture = { manifest: headManifest, documents: headDocs, digest: approved['1.4.0'], createdAt: '2026-09-23T00:00:00.000Z' }

const legalJs = read('src/utils/legal.js')
const patchedLegalJs = legalJs
  .replace("import previousArchive from '../../legal/test-fixtures/1.3.0.json' with { type: 'json' }\n",
    "import archive13 from '../../legal/test-fixtures/1.3.0.json' with { type: 'json' }\nimport archive14 from '../../legal/test-fixtures/1.4.0.json' with { type: 'json' }\n")
  .replace("  '1.3.0': previousArchive,\n  '1.4.0': { manifest, documents },",
    "  // Versões anteriores continuam aceitas: a 1.4.0 nunca é editada (fixture imutável) e quem tem a 1.4.0 vigente no\n  // banco segue funcionando até a 1.5.0 ser publicada em legal_policy.\n  '1.3.0': archive13,\n  '1.4.0': archive14,\n  '1.5.0': { manifest, documents },")

if (check) {
  console.log(JSON.stringify({ manifestAtual: json('legal/manifest.json').version, digests: approved, digestCalculado1_5_0: newDigest, fixture14: existsSync('legal/test-fixtures/1.4.0.json') }, null, 2))
  process.exit(0)
}
writeFileSync('legal/test-fixtures/1.4.0.json', `${JSON.stringify(fixture, null, 2)}\n`)
writeFileSync('legal/documents.json', newDocsText)
writeFileSync('legal/manifest.json', `${JSON.stringify(newManifest, null, 2)}\n`)
writeFileSync('legal/approved-digests.json', `${JSON.stringify({ ...approved, '1.5.0': newDigest }, null, 2)}\n`)
if (patchedLegalJs === legalJs) throw new Error('src/utils/legal.js não foi alterado (padrão não encontrado)')
writeFileSync('src/utils/legal.js', patchedLegalJs)
console.log(`v1.5.0 preparada. digest=${newDigest}`)
