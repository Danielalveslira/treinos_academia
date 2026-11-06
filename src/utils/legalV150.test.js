// Matriz da transição 1.5.0 → 2.0.0 → 2.1.0, sem copiar dados pessoais do arquivo histórico.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import archive13 from '../../legal/test-fixtures/1.3.0.json' with { type: 'json' }
import archive14 from '../../legal/test-fixtures/1.4.0.json' with { type: 'json' }
import archive20 from '../../legal/test-fixtures/2.0.0.json' with { type: 'json' }
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

const archive21 = { manifest: LEGAL_MANIFEST, documents: LEGAL_DOCUMENTS, digest: APPROVED_LEGAL_DIGESTS['2.1.0'] }
const archives = { '1.3.0': archive13, '1.4.0': archive14, '2.0.0': archive20, '2.1.0': archive21 }
const policyOf = (version) => ({ version, digest: APPROVED_LEGAL_DIGESTS[version], published: true })
const bundleOf = (version) => resolveLegalBundle(policyOf(version), archives[version])
const accepted = (version) => ({ version, digest: APPROVED_LEGAL_DIGESTS[version], acceptedAt: { seconds: 1 } })
const accessOf = (bundle) => ({ policy: policyOf(bundle.manifest.version), restriction: undefined, legalBundle: bundle })
const state = (profile, bundle) => resolveLegalGateState({ profile, access: accessOf(bundle), loading: false, error: null })

test('o cliente reconhece as versões históricas e a 2.1.0 antes da ativação no banco', async () => {
  assert.deepEqual(SUPPORTED_LEGAL_VERSIONS, ['1.3.0', '1.4.0', '1.5.0', '2.0.0', '2.1.0'])
  assert.equal(LEGAL_MANIFEST.version, '2.1.0')
  for (const version of ['1.3.0', '1.4.0', '2.0.0', '2.1.0']) {
    const bundle = await bundleOf(version)
    assert.equal(bundle.manifest.version, version)
    assert.equal(bundle.digest, APPROVED_LEGAL_DIGESTS[version])
  }
})

test('versões arquivadas são imutáveis: o digest recalculado do arquivo bate com o aprovado', async () => {
  assert.equal(await legalDigest(archive13.manifest, archive13.documents), APPROVED_LEGAL_DIGESTS['1.3.0'])
  assert.equal(await legalDigest(archive14.manifest, archive14.documents), APPROVED_LEGAL_DIGESTS['1.4.0'])
  assert.equal(await legalDigest(archive20.manifest, archive20.documents), APPROVED_LEGAL_DIGESTS['2.0.0'])
  assert.equal(await legalDigest(LEGAL_MANIFEST, LEGAL_DOCUMENTS), APPROVED_LEGAL_DIGESTS['2.1.0'])
  assert.equal(APPROVED_LEGAL_DIGESTS['1.5.0'], '9f7f12926c8788ee4a8dbf03ab1074f330525b3207dac5a5ddc7138b8f5b2d95')
})

test('banco ainda na 1.4.0 com o cliente novo: quem aceitou a 1.4.0 segue liberado, sem tela de aceite', async () => {
  const bundle = await bundleOf('1.4.0')
  assert.equal(state({ role: 'user', legalAcceptance: accepted('1.4.0') }, bundle), 'allowed')
})

test('banco na 2.0.0 (histórico): quem aceitou a 1.5.0 precisa aceitar a 2.0.0; depois fica liberado', async () => {
  const bundle = await bundleOf('2.0.0')
  assert.equal(state({ role: 'user', legalAcceptance: accepted('1.5.0') }, bundle), 'acceptance-required')
  assert.equal(state({ role: 'user', legalAcceptance: accepted('2.0.0') }, bundle), 'allowed')
})

test('banco na 2.1.0: quem aceitou a 2.0.0 precisa aceitar a 2.1.0; depois fica liberado', async () => {
  const bundle = await bundleOf('2.1.0')
  assert.equal(state({ role: 'user', legalAcceptance: accepted('2.0.0') }, bundle), 'acceptance-required')
  assert.equal(state({ role: 'user', legalAcceptance: accepted('2.1.0') }, bundle), 'allowed')
})

test('usuário novo e troca de conta: cada perfil é avaliado pelo próprio aceite', async () => {
  const bundle = await bundleOf('2.1.0')
  assert.equal(state({ role: 'user', legalAcceptance: null }, bundle), 'acceptance-required')
  assert.equal(needsLegalAcceptance(accepted('2.1.0'), policyOf('2.1.0')), false)
  assert.equal(needsLegalAcceptance({ ...accepted('2.1.0'), digest: 'a'.repeat(64) }, policyOf('2.1.0')), true, 'mesmo número de versão com digest diferente não vale')
})

test('conteúdo: a 2.1.0 informa Supabase e métricas; a 1.4.0 arquivada continua intacta', () => {
  const privacy = (docs) => docs.find((d) => d.id === 'privacy')
  const text = (doc) => JSON.stringify(doc)
  assert.doesNotMatch(text(privacy(LEGAL_DOCUMENTS)), /Firebase/)
  assert.match(text(privacy(LEGAL_DOCUMENTS)), /Supabase/)
  assert.ok(privacy(LEGAL_DOCUMENTS).sections.some((s) => s.id === 'anuncios'))
  assert.match(text(privacy(archive14.documents)), /Google Firebase/, 'a v1.4.0 histórica não é editada')
  assert.equal(LEGAL_MANIFEST.minimumAge, 16)
})
