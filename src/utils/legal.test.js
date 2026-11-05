import { test } from 'node:test'
import assert from 'node:assert/strict'
import oldArchive from '../../legal/test-fixtures/1.3.0.json' with { type: 'json' }
import archive14 from '../../legal/test-fixtures/1.4.0.json' with { type: 'json' }
import {
  APPROVED_LEGAL_DIGESTS,
  LEGAL_DOCUMENTS,
  LEGAL_MANIFEST,
  canSubmitLegalRegistration,
  buildLegalAcceptancePayload,
  resolveHistoricalLegalBundle,
  isValidLegalVersionParam,
  clearCachedLegalAccess,
  isAccountRestricted,
  isLegalPolicyOutdated,
  legalConsentDocumentLinks,
  needsLegalAcceptance,
  resolveAccountBlockState,
  resolveLegalBundle,
  resolveLegalGateState,
  selectLegalDocument,
} from './legal.js'

const newArchive = {
  manifest: LEGAL_MANIFEST,
  documents: LEGAL_DOCUMENTS,
  digest: APPROVED_LEGAL_DIGESTS[LEGAL_MANIFEST.version],
}

// Cada versão aprovada tem o seu arquivo imutável; a vigente no repositório é a de LEGAL_MANIFEST.
const ARCHIVES = { '1.3.0': oldArchive, '1.4.0': archive14, [LEGAL_MANIFEST.version]: newArchive }

function active(version) {
  const archive = ARCHIVES[version]
  return resolveLegalBundle(
    { version, digest: APPROVED_LEGAL_DIGESTS[version], published: true },
    archive
  )
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]))
  }
  return value
}

function access(bundle) {
  return {
    policy: { version: bundle.manifest.version, digest: bundle.digest, published: true },
    restriction: undefined,
    legalBundle: bundle,
  }
}

function fakeStorage(entries) {
  const values = new Map(entries)
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    removeItem(key) { values.delete(key) },
    has(key) { return values.has(key) },
  }
}

test('loads and displays the complete immutable archive matching active versions 1.3.0 and 1.4.0', async () => {
  for (const version of ['1.3.0', '1.4.0']) {
    const bundle = await active(version)
    assert.equal(bundle.manifest.version, version)
    assert.ok(bundle.documents.length >= 3)
    assert.equal(bundle.digest, APPROVED_LEGAL_DIGESTS[version])
    const archive = ARCHIVES[version]
    const reorderedArchive = reverseKeys(archive)
    const resolvedFromReordered = await resolveLegalBundle(
      { version, digest: APPROVED_LEGAL_DIGESTS[version], published: true },
      reorderedArchive
    )
    assert.deepEqual(resolvedFromReordered.documents, bundle.documents)
    await assert.rejects(
      resolveLegalBundle(
        { version, digest: APPROVED_LEGAL_DIGESTS[version], published: true },
        { ...reorderedArchive, documents: [...reorderedArchive.documents].reverse() }
      ),
      /LEGAL_POLICY_INCOMPATIBLE/
    )
    assert.ok(selectLegalDocument(bundle, 'privacy')?.sections.length)
    assert.equal(selectLegalDocument(bundle, 'missing-document'), null)
    assert.deepEqual(
      legalConsentDocumentLinks(bundle).map((link) => link.to),
      ['/termos-de-uso', '/regras-da-comunidade', '/politica-de-privacidade'].map(
        (path) => `${path}?version=${version}`
      )
    )
  }
})

test('digest, archive version, policy publication, and archive content must all match', async () => {
  const bundle = await active('1.3.0')
  await assert.rejects(
    resolveLegalBundle({ version: '1.3.0', digest: 'forged', published: true }, oldArchive),
    /LEGAL_POLICY_INCOMPATIBLE/
  )
  await assert.rejects(
    resolveLegalBundle({ version: '1.4.0', digest: bundle.digest, published: true }, oldArchive),
    /LEGAL_POLICY_INCOMPATIBLE/
  )
  await assert.rejects(
    resolveLegalBundle({ version: '1.3.0', digest: bundle.digest, published: false }, oldArchive),
    /LEGAL_POLICY_INCOMPATIBLE/
  )
  await assert.rejects(
    resolveLegalBundle(
      { version: '1.3.0', digest: bundle.digest, published: true },
      { ...oldArchive, documents: [{ ...oldArchive.documents[0], title: 'Alterado' }] }
    ),
    /LEGAL_POLICY_INCOMPATIBLE/
  )
  await assert.rejects(
    resolveLegalBundle({ version: '9.9.9', digest: 'anything', published: true }, oldArchive),
    /LEGAL_POLICY_INCOMPATIBLE/
  )
})

test('a 1.5.0 preserva seu digest e não aceita o conteúdo da 2.0.0 como histórico', async () => {
  const archive = reverseKeys(newArchive)
  const policy = { version: '1.5.0', digest: APPROVED_LEGAL_DIGESTS['1.5.0'], published: true }
  assert.equal(APPROVED_LEGAL_DIGESTS['1.5.0'], '9f7f12926c8788ee4a8dbf03ab1074f330525b3207dac5a5ddc7138b8f5b2d95')
  await assert.rejects(
    resolveLegalBundle(policy, archive),
    /LEGAL_POLICY_INCOMPATIBLE/
  )
})

test('registration requires the active published bundle and only the contractual acceptance', async () => {
  const bundle = await active('1.3.0')
  assert.equal(canSubmitLegalRegistration({ bundle, loading: false, confirmed: { accepted: true, healthDataConsent: true } }), true)
  assert.equal(canSubmitLegalRegistration({ bundle, loading: false, confirmed: { accepted: true, healthDataConsent: false } }), true, 'health consent is optional')
  assert.equal(canSubmitLegalRegistration({ bundle, loading: true, confirmed: { accepted: true } }), false)
  assert.equal(canSubmitLegalRegistration({ bundle, loading: false, confirmed: { accepted: false, healthDataConsent: true } }), false)
  assert.equal(canSubmitLegalRegistration({ bundle, loading: false, confirmed: { accepted: 'true' } }), false)
  assert.equal(canSubmitLegalRegistration({ bundle: null, loading: false, confirmed: { accepted: true } }), false)
})

test('acceptance payload never carries legal content and only sends health consent when chosen', async () => {
  const bundle = await active('1.4.0')
  const base = buildLegalAcceptancePayload({ bundle, confirmed: { accepted: true }, source: 'signup', healthTextVersion: 'health-data-1' })
  assert.deepEqual(Object.keys(base).sort(), ['accepted', 'digest', 'source', 'version'])
  assert.equal(base.digest, APPROVED_LEGAL_DIGESTS['1.4.0'])
  const withHealth = buildLegalAcceptancePayload({ bundle, confirmed: { accepted: true, healthDataConsent: true }, source: 'reacceptance', healthTextVersion: 'health-data-1' })
  assert.equal(withHealth.healthConsentTextVersion, 'health-data-1')
  assert.equal('manifest' in withHealth || 'documents' in withHealth, false)
})

test('historical versions open their own immutable text and reject tampered digests', () => {
  const archive = ARCHIVES['1.3.0']
  const row = { version: '1.3.0', manifest: archive.manifest, documents: archive.documents, digest: APPROVED_LEGAL_DIGESTS['1.3.0'] }
  const historical = resolveHistoricalLegalBundle('1.3.0', row)
  assert.equal(historical.manifest.version, '1.3.0')
  assert.ok(selectLegalDocument(historical, 'terms'))
  assert.throws(() => resolveHistoricalLegalBundle('1.3.0', { ...row, digest: 'f'.repeat(64) }), /LEGAL_HISTORY_INTEGRITY/)
  assert.equal(resolveHistoricalLegalBundle('1.3.0', null), null, 'unpublished or missing versions do not render')
  assert.equal(resolveHistoricalLegalBundle('1.4.0', row), null, 'row must match the requested version')
  assert.equal(isValidLegalVersionParam('1.3.0'), true)
  assert.equal(isValidLegalVersionParam('../1'), false)
  assert.equal(isValidLegalVersionParam(''), false)
})

test('acceptance transitions force 1.4.0 after 1.3.0 and incompatible tabs remain blocked', async () => {
  const v13 = await active('1.3.0')
  const v14 = await active('1.4.0')
  const acceptance13 = { version: '1.3.0', digest: v13.digest, acceptedAt: { seconds: 1 } }
  assert.equal(needsLegalAcceptance(acceptance13, access(v13).policy), false)
  assert.equal(needsLegalAcceptance(acceptance13, access(v14).policy), true)
  assert.equal(isLegalPolicyOutdated(access(v13)), false)
  assert.equal(isLegalPolicyOutdated({ ...access(v14), legalBundle: v13 }), true)
  assert.equal(resolveLegalGateState({ profile: { role: 'user', legalAcceptance: acceptance13 }, access: access(v14), loading: false, error: '' }), 'acceptance-required')
  assert.equal(resolveLegalGateState({ profile: { role: 'user' }, access: { ...access(v14), legalBundle: null }, loading: false, error: '' }), 'policy-unavailable')
})

test('legacy authorization caches are cleared, restrictions still take precedence, superadmins can repair unavailable policy', async () => {
  const storage = fakeStorage([['legalAccess:user-a', '{}'], ['colorMode', 'dark']])
  clearCachedLegalAccess(storage)
  assert.equal(storage.has('legalAccess:user-a'), false)
  assert.equal(storage.has('colorMode'), true)
  const bundle = await active('1.4.0')
  assert.equal(isAccountRestricted({ action: 'system_ban' }), true)
  assert.equal(resolveLegalGateState({ profile: { role: 'superadmin' }, access: { ...access(bundle), legalBundle: null }, loading: false, error: '' }), 'allowed')
})

test('cliente que não conhece a versão publicada fica em "policy-unavailable" (sem loop de reaceite); o superadmin alcança o painel', async () => {
  // Simula um app antigo (PWA aberta) depois que o banco passa a publicar uma versão que este bundle não aprova.
  const policy = { version: '9.9.9', digest: 'f'.repeat(64), published: true }
  await assert.rejects(resolveLegalBundle(policy, newArchive), /LEGAL_POLICY_INCOMPATIBLE/)
  const current = APPROVED_LEGAL_DIGESTS[LEGAL_MANIFEST.version]
  const profile = (role) => ({ role, legalAcceptance: { version: LEGAL_MANIFEST.version, digest: current, acceptedAt: { seconds: 1 } } })
  const blocked = { policy, restriction: undefined, legalBundle: null }
  assert.equal(resolveLegalGateState({ profile: profile('user'), access: blocked, loading: false, error: null }), 'policy-unavailable')
  assert.equal(resolveLegalGateState({ profile: profile('superadmin'), access: blocked, loading: false, error: null }), 'allowed')
  // quem já aceitou a versão que o bundle conhece NÃO é mandado aceitar de novo (sem piscar a tela de aceite)
  const fresh = await active(LEGAL_MANIFEST.version)
  assert.equal(resolveLegalGateState({ profile: profile('user'), access: access(fresh), loading: false, error: null }), 'allowed')
})

// F1.2 (correção pós-F1): ProtectedRoute.jsx usa resolveAccountBlockState para decidir qual
// aviso mostrar a uma conta bloqueada -- ver src/components/AccountBlockedGate.jsx. Testado
// aqui como função pura (sem React) para cobrir a ordem de precedência e os limites de tempo
// da suspensão sem precisar renderizar nada.
test('resolveAccountBlockState: account_status (deleting/disabled) sempre vence restrição, mesmo coexistindo', () => {
  const restriction = { action: 'system_ban', until: null }
  assert.equal(resolveAccountBlockState({ profile: { accountStatus: 'deleting' }, restriction }), 'deleting')
  assert.equal(resolveAccountBlockState({ profile: { accountStatus: 'disabled' }, restriction }), 'disabled')
})

test('resolveAccountBlockState: distingue banida (system_ban) de suspensa (temporary_suspension ainda vigente)', () => {
  const now = Date.parse('2026-06-01T00:00:00Z')
  assert.equal(
    resolveAccountBlockState({
      profile: { accountStatus: 'active' },
      restriction: { action: 'system_ban', until: null },
      now,
    }),
    'banned'
  )
  assert.equal(
    resolveAccountBlockState({
      profile: { accountStatus: 'active' },
      restriction: { action: 'temporary_suspension', until: '2026-07-01T00:00:00Z' },
      now,
    }),
    'suspended'
  )
})

test('resolveAccountBlockState: suspensão já vencida e conta sem restrição não bloqueiam', () => {
  const now = Date.parse('2026-06-01T00:00:00Z')
  assert.equal(
    resolveAccountBlockState({
      profile: { accountStatus: 'active' },
      restriction: { action: 'temporary_suspension', until: '2026-01-01T00:00:00Z' },
      now,
    }),
    null
  )
  assert.equal(resolveAccountBlockState({ profile: { accountStatus: 'active' }, restriction: null }), null)
  assert.equal(resolveAccountBlockState({ profile: null, restriction: { action: 'system_ban' } }), null)
})
