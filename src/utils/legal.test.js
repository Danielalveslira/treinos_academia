import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearCachedLegalAccess,
  isAccountRestricted,
  isLegalPolicyOutdated,
  LEGAL_MANIFEST,
  needsLegalAcceptance,
  resolveLegalGateState,
} from './legal.js'

const policy = { version: LEGAL_MANIFEST.version, published: true, digest: 'digest-atual' }
const currentAcceptance = {
  version: policy.version,
  digest: policy.digest,
  acceptedAt: { seconds: 1 },
}
const regularProfile = { role: 'user', legalAcceptance: currentAcceptance }

function state(overrides = {}) {
  return resolveLegalGateState({
    profile: regularProfile,
    access: { policy, restriction: undefined },
    loading: false,
    error: '',
    ...overrides,
  })
}

function fakeStorage(entries) {
  const values = new Map(entries)
  return {
    get length() {
      return values.size
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    has(key) {
      return values.has(key)
    },
  }
}

test('regular user with current version, digest, and no restriction is allowed', () => {
  assert.equal(state(), 'allowed')
})

test('an outdated acceptance requires re-accepting', () => {
  assert.equal(
    state({
      profile: {
        ...regularProfile,
        legalAcceptance: { ...currentAcceptance, version: '1.2.0' },
      },
    }),
    'acceptance-required'
  )
})

test('a missing acceptance requires accepting', () => {
  assert.equal(
    state({ profile: { ...regularProfile, legalAcceptance: undefined } }),
    'acceptance-required'
  )
})

test('an acceptance with the current version but a different digest is blocked', () => {
  assert.equal(needsLegalAcceptance({ ...currentAcceptance, digest: 'outro' }, policy), true)
  assert.equal(
    state({
      profile: { ...regularProfile, legalAcceptance: { ...currentAcceptance, digest: 'outro' } },
    }),
    'acceptance-required'
  )
})

test('unknown policy/restriction state is neutral loading, never the legal form', () => {
  assert.equal(state({ access: null, loading: true }), 'loading')
  assert.equal(state({ access: null, loading: false }), 'loading')
})

test('a current cached authorization never decides access and legacy caches are removed', () => {
  const storage = fakeStorage([
    ['legalAccess:user-a', JSON.stringify({ policy })],
    ['colorMode', 'dark'],
  ])
  clearCachedLegalAccess(storage)
  assert.equal(storage.has('legalAccess:user-a'), false)
  assert.equal(storage.has('colorMode'), true)
  assert.equal(state({ access: null, loading: true }), 'loading')
})

test('old caches from multiple users are cleared so logout/login cannot mix access', () => {
  const storage = fakeStorage([
    ['legalAccess:user-a', '{}'],
    ['legalAccess:user-b', '{}'],
    ['unrelated', 'kept'],
  ])
  clearCachedLegalAccess(storage)
  assert.equal(storage.has('legalAccess:user-a'), false)
  assert.equal(storage.has('legalAccess:user-b'), false)
  assert.equal(storage.has('unrelated'), true)
})

test('the previous legal policy blocks the new bundle until publication', () => {
  assert.equal(
    isLegalPolicyOutdated({ policy: { ...policy, version: '1.3.0' } }, LEGAL_MANIFEST.version),
    true
  )
  assert.equal(
    state({ access: { policy: { ...policy, version: '1.3.0' }, restriction: undefined } }),
    'policy-unavailable'
  )
})

test('a network error has its own state and is not called a policy update', () => {
  assert.equal(state({ access: null, error: 'Falha de rede' }), 'error')
  assert.equal(isLegalPolicyOutdated(null), false)
})

test('an unpublished, missing-digest, or missing policy is unavailable', () => {
  assert.equal(state({ access: { policy: { ...policy, published: false } } }), 'policy-unavailable')
  assert.equal(state({ access: { policy: { ...policy, digest: '' } } }), 'policy-unavailable')
  assert.equal(state({ access: { policy: undefined } }), 'policy-unavailable')
})

test('a restriction wins over acceptance and policy presentation', () => {
  assert.equal(state({ access: { policy, restriction: { action: 'system_ban' } } }), 'restricted')
})

test('a reload without an authoritative result stays neutral, then releases a regular user', () => {
  assert.equal(state({ access: null, loading: true }), 'loading')
  assert.equal(state(), 'allowed')
})

test('superadmin can reach the publishing panel for an inconsistent policy', () => {
  assert.equal(
    state({
      profile: { ...regularProfile, role: 'superadmin' },
      access: { policy: { ...policy, published: false } },
    }),
    'allowed'
  )
})

test('isAccountRestricted handles expired and active suspensions', () => {
  const now = Date.now()
  assert.equal(isAccountRestricted(null, now), false)
  assert.equal(
    isAccountRestricted({ action: 'temporary_suspension', until: new Date(now - 1000) }, now),
    false
  )
  assert.equal(
    isAccountRestricted({ action: 'temporary_suspension', until: new Date(now + 1000) }, now),
    true
  )
})
