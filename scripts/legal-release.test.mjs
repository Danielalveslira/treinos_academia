import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { planLegalRelease, legalBundleDigest } from './seed-legal.mjs'
import { planDocumentPublication, ALLOWED_DOCUMENTS } from './publish-legal-document.mjs'

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)))
const manifest = read('../legal/manifest.json')
const documents = read('../legal/documents.json')
const approvedDigests = read('../legal/approved-digests.json')

test('versão vigente do pacote geral confere com o digest aprovado no app', () => {
  const plan = planLegalRelease({ manifest, documents, approvedDigests, activate: false })
  assert.equal(plan.digest, approvedDigests[manifest.version])
  assert.equal(plan.activate, false)
})

test('alteração silenciosa do texto de uma versão publicada é recusada', () => {
  const tampered = structuredClone(documents)
  tampered[0].title += ' (editado)'
  assert.throws(() => planLegalRelease({ manifest, documents: tampered, approvedDigests }), /LEGAL_DIGEST_NOT_APPROVED_IN_APP/)
})

test('minuta não é registrada e ativação exige confirmação explícita da versão', () => {
  assert.throws(() => planLegalRelease({ manifest: { ...manifest, published: false }, documents, approvedDigests }), /LEGAL_DRAFT_NOT_PUBLISHABLE/)
  assert.throws(() => planLegalRelease({ manifest, documents, approvedDigests, activate: true }), /LEGAL_ACTIVATION_NOT_CONFIRMED/)
  assert.equal(planLegalRelease({ manifest, documents, approvedDigests, activate: true, confirmation: manifest.version }).activate, true)
  assert.equal(legalBundleDigest(manifest, documents), approvedDigests[manifest.version])
})

test('minutas jurídicas do repositório nunca estão marcadas como aprovadas ou publicadas', () => {
  const dir = new URL('../legal/drafts/', import.meta.url)
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
  assert.ok(files.length >= 5, 'minutas presentes')
  for (const name of files) {
    const draft = JSON.parse(readFileSync(new URL(name, dir)))
    assert.notEqual(draft.approved, true, `${name} não pode estar aprovada automaticamente`)
    assert.notEqual(draft.published, true, `${name} não pode estar publicada automaticamente`)
    if (draft.documentId) {
      assert.ok(ALLOWED_DOCUMENTS.includes(draft.documentId), name)
      assert.throws(() => planDocumentPublication(draft, { publish: true, confirmation: `${draft.documentId}@${draft.version}` }), /LEGAL_DRAFT_NOT_PUBLISHABLE/)
    }
  }
})

test('minutas exigem 16+, usam a marca Evolutus e não prometem verificação de identidade', () => {
  const dir = new URL('../legal/drafts/', import.meta.url)
  // 2.0.0 já foi publicada (ver legal/manifest.json); a minuta na pasta drafts/ é mantida como
  // registro histórico e continua com published:false/date placeholder propositalmente.
  const draftManifest20 = read('../legal/drafts/general-2.0.0.manifest.json')
  assert.equal(draftManifest20.minimumAge, 18)
  assert.equal(draftManifest20.published, false)
  assert.equal(draftManifest20.date, 'AAAA-MM-DD', 'data efetiva só após aprovação')
  // 2.1.0 é a minuta em revisão: idade mínima de cadastro cai para 16 (compras/contratações
  // continuam 18+, ver legal/commercial/*).
  const draftManifest21 = read('../legal/drafts/general-2.1.0.manifest.json')
  assert.equal(draftManifest21.minimumAge, 16)
  assert.equal(draftManifest21.published, false)
  assert.equal(draftManifest21.date, 'AAAA-MM-DD', 'data efetiva só após aprovação')
  const files = readdirSync(dir).filter((name) => name.endsWith('.json') && !name.endsWith('.manifest.json'))
  for (const name of files) {
    const text = readFileSync(new URL(name, dir), 'utf8')
    assert.match(text, /Evolutus/, `${name}: identifica a plataforma como Evolutus`)
    // "Treinos" como nome da plataforma (marca antiga); a palavra comum treino/treinos continua válida.
    assert.doesNotMatch(text, /\b(?:[Oo]|[Dd]o|[Nn]o|[Pp]elo|app|aplicativo|plataforma) Treinos\b/, `${name}: sem marca antiga`)
    // Piso vigente: 16 anos (20261213000002). Nenhuma minuta pode declarar idade abaixo disso.
    assert.doesNotMatch(text, /a partir de (?:12|13|14|15) anos|minimumAge"\s*:\s*(?:1[0-5])\b/, `${name}: sem idade inferior a 16`)
    assert.doesNotMatch(text, /verifica(?:mos|ção documental de) (?:sua )?identidade|comprovamos sua idade/i, `${name}: sem promessa de verificação documental`)
    const draft = JSON.parse(text)
    if (draft.documentId) assert.equal(draft.date, 'AAAA-MM-DD', `${name}: data pendente`)
  }
  // 2.1.0 foi promovida: idade mínima de cadastro vigente agora é 16. Os digests históricos
  // (1.5.0 e 2.0.0 incluídos) permanecem registrados sem alteração.
  assert.equal(manifest.version, '2.1.0')
  assert.equal(manifest.minimumAge, 16)
  assert.equal(approvedDigests['1.5.0'], '9f7f12926c8788ee4a8dbf03ab1074f330525b3207dac5a5ddc7138b8f5b2d95')
  assert.equal(approvedDigests['2.0.0'], '00b31d68381231907b60daa58500f37c4d5821244863c421384b30b2717a9f89')
})

test('publicação de documento comercial aprovado exige confirmação nominal', () => {
  const content = { documentId: 'evocash-terms', version: '1.0.0', approved: true, title: 'X' }
  assert.equal(planDocumentPublication(content, { publish: false }).publish, false)
  assert.throws(() => planDocumentPublication(content, { publish: true, confirmation: 'evocash-terms@0.9.0' }), /NOT_CONFIRMED/)
  assert.equal(planDocumentPublication(content, { publish: true, confirmation: 'evocash-terms@1.0.0' }).publish, true)
  assert.throws(() => planDocumentPublication({ ...content, documentId: 'other' }, { publish: false }), /UNKNOWN/)
})
