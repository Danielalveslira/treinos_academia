import { test } from 'node:test'
import assert from 'node:assert/strict'
import oldArchive from '../../legal/test-fixtures/1.3.0.json' with { type: 'json' }
import {
  APPROVED_LEGAL_DIGESTS,
  LEGAL_DOCUMENTS,
  LEGAL_MANIFEST,
  canSubmitLegalRegistration,
  clearCachedLegalAccess,
  isAccountRestricted,
  isLegalPolicyOutdated,
  legalConsentDocumentLinks,
  needsLegalAcceptance,
  resolveLegalBundle,
  resolveLegalGateState,
  selectLegalDocument,
} from './legal.js'

const newArchive = {
  manifest: LEGAL_MANIFEST,
  documents: LEGAL_DOCUMENTS,
  digest: APPROVED_LEGAL_DIGESTS[LEGAL_MANIFEST.version],
}

function active(version) {
  const archive = version === '1.3.0' ? oldArchive : newArchive
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
    const archive = version === '1.3.0' ? oldArchive : newArchive
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
    assert.ok(selectLegalDocument(bundle, 'privacy', version)?.sections.length)
    assert.equal(selectLegalDocument(bundle, 'privacy', version === '1.3.0' ? '1.4.0' : '1.3.0'), null)
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

test('registration requires the active published bundle and both explicit confirmations', async () => {
  const bundle = await active('1.3.0')
  assert.equal(canSubmitLegalRegistration({ bundle, loading: false, confirmed: { accepted: true, healthDataConsent: true } }), true)
  assert.equal(canSubmitLegalRegistration({ bundle, loading: true, confirmed: { accepted: true, healthDataConsent: true } }), false)
  assert.equal(canSubmitLegalRegistration({ bundle, loading: false, confirmed: { accepted: false, healthDataConsent: true } }), false)
  assert.equal(canSubmitLegalRegistration({ bundle, loading: false, confirmed: { accepted: true, healthDataConsent: false } }), false)
  assert.equal(canSubmitLegalRegistration({ bundle: null, loading: false, confirmed: { accepted: true, healthDataConsent: true } }), false)
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
