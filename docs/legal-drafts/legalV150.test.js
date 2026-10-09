// Matriz de compatibilidade da v1.5.0. Mover para src/utils/legalV150.test.js DEPOIS de aplicar
// docs/legal-drafts/apply-legal-v1.5.0.mjs (os arquivos de legal/ precisam estar na 1.5.0) e rodar `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import archive13 from '../../legal/test-fixtures/1.3.0.json' with { type: 'json' }
import archive14 from '../../legal/test-fixtures/1.4.0.json' with { type: 'json' }
import {
  APPROVED_LEGAL_DIGESTS,
  LEGAL_DOCUMENTS,
  LEGAL_MANIFEST,
  SUPPORTED_LEGAL_VERSIONS,
  needsLegalAcceptance,
  resolveLegalBundle,
  resolveLegalGateState,
} from './legal.js'
import { legalDigest } from './legalDigest.js'

const archive15 = { manifest: LEGAL_MANIFEST, documents: LEGAL_DOCUMENTS, digest: APPROVED_LEGAL_DIGESTS['1.5.0'] }
const archives = { '1.3.0': archive13, '1.4.0': archive14, '1.5.0': archive15 }
const policyOf = (version) => ({ version, digest: APPROVED_LEGAL_DIGESTS[version], published: true })
const bundleOf = (version) => resolveLegalBundle(policyOf(version), archives[version])
const accepted = (version) => ({ version, digest: APPROVED_LEGAL_DIGESTS[version], acceptedAt: { seconds: 1 } })
const accessOf = (bundle) => ({ policy: policyOf(bundle.manifest.version), restriction: undefined, legalBundle: bundle })
const state = (profile, bundle) => resolveLegalGateState({ profile, access: accessOf(bundle), loading: false, error: null })

test('o cliente novo aprova as três versões ao mesmo tempo (janela segura entre deploy e publicação no banco)', async () => {
  assert.deepEqual(SUPPORTED_LEGAL_VERSIONS, ['1.3.0', '1.4.0', '1.5.0'])
  assert.equal(LEGAL_MANIFEST.version, '1.5.0')
  for (const version of SUPPORTED_LEGAL_VERSIONS) {
    const bundle = await bundleOf(version)
    assert.equal(bundle.manifest.version, version)
    assert.equal(bundle.digest, APPROVED_LEGAL_DIGESTS[version])
  }
})

test('versões arquivadas são imutáveis: o digest recalculado do arquivo bate com o aprovado', async () => {
  assert.equal(await legalDigest(archive13.manifest, archive13.documents), APPROVED_LEGAL_DIGESTS['1.3.0'])
  assert.equal(await legalDigest(archive14.manifest, archive14.documents), APPROVED_LEGAL_DIGESTS['1.4.0'])
  assert.equal(await legalDigest(LEGAL_MANIFEST, LEGAL_DOCUMENTS), APPROVED_LEGAL_DIGESTS['1.5.0'])
})

test('banco ainda na 1.4.0 com o cliente novo: quem aceitou a 1.4.0 segue liberado, sem tela de aceite', async () => {
  const bundle = await bundleOf('1.4.0')
  assert.equal(state({ role: 'user', legalAcceptance: accepted('1.4.0') }, bundle), 'allowed')
})

test('banco na 1.5.0: quem aceitou a 1.4.0 precisa aceitar a 1.5.0; depois do aceite, fica liberado (sem loop)', async () => {
  const bundle = await bundleOf('1.5.0')
  assert.equal(state({ role: 'user', legalAcceptance: accepted('1.4.0') }, bundle), 'acceptance-required')
  assert.equal(state({ role: 'user', legalAcceptance: accepted('1.5.0') }, bundle), 'allowed')
})

test('usuário novo e troca de conta: cada perfil é avaliado pelo próprio aceite', async () => {
  const bundle = await bundleOf('1.5.0')
  assert.equal(state({ role: 'user', legalAcceptance: null }, bundle), 'acceptance-required')
  assert.equal(needsLegalAcceptance(accepted('1.5.0'), policyOf('1.5.0')), false)
  assert.equal(needsLegalAcceptance({ ...accepted('1.5.0'), digest: 'a'.repeat(64) }, policyOf('1.5.0')), true, 'mesmo número de versão com digest diferente não vale')
})

test('conteúdo: a 1.5.0 corrige o Firebase e descreve a medição; a 1.4.0 arquivada continua intacta', () => {
  const privacy = (docs) => docs.find((d) => d.id === 'privacy')
  const text = (doc) => JSON.stringify(doc)
  assert.doesNotMatch(text(privacy(LEGAL_DOCUMENTS)), /Firebase/)
  assert.match(text(privacy(LEGAL_DOCUMENTS)), /Supabase/)
  assert.ok(privacy(LEGAL_DOCUMENTS).sections.some((s) => s.id === 'anuncios'))
  assert.match(text(privacy(archive14.documents)), /Google Firebase/, 'a v1.4.0 histórica não é editada')
  for (const id of ['community', 'terms']) {
    assert.deepEqual(LEGAL_DOCUMENTS.find((d) => d.id === id), archive14.documents.find((d) => d.id === id), `${id} não mudou`)
  }
})
