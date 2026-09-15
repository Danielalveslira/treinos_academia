import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAccountRestricted,
  isCachedAccessValid,
  isLegalPolicyOutdated,
  needsLegalAcceptance,
} from './legal.js'

const CURRENT = '1.3.0'

// Cenário 1: cache 1.2.0 + manifest 1.3.0 -> cache precisa ser ignorado.
test('isCachedAccessValid rejects a cache written under a different manifest version', () => {
  assert.equal(
    isCachedAccessValid({ policy: { version: '1.2.0', published: true } }, CURRENT),
    false
  )
})

// Cenário 2: cache compatível pode ser usado como estado inicial.
test('isCachedAccessValid accepts a cache that matches the current manifest version', () => {
  assert.equal(
    isCachedAccessValid({ policy: { version: CURRENT, published: true } }, CURRENT),
    true
  )
})

test('isCachedAccessValid treats a missing/malformed cache as invalid, never throws', () => {
  assert.equal(isCachedAccessValid(null, CURRENT), false)
  assert.equal(isCachedAccessValid(undefined, CURRENT), false)
  assert.equal(isCachedAccessValid({}, CURRENT), false)
  assert.equal(isCachedAccessValid({ policy: null }, CURRENT), false)
})

// Cenário 3: policy fresca (não é cache -- já veio do Firestore) com versão ou
// published divergentes é, de fato, um estado de publicação inconsistente.
test('isLegalPolicyOutdated is true when the fetched policy version or published flag diverges', () => {
  assert.equal(
    isLegalPolicyOutdated({ policy: { version: '1.2.0', published: true } }, CURRENT),
    true
  )
  assert.equal(
    isLegalPolicyOutdated({ policy: { version: CURRENT, published: false } }, CURRENT),
    true
  )
  assert.equal(
    isLegalPolicyOutdated({ policy: { version: CURRENT, published: true } }, CURRENT),
    false
  )
})

// Cenário 6: enquanto a policy ainda não chegou (access null -- é exatamente o que
// acontece durante um erro de rede, já que o .catch() nunca chama setAccess), outdated
// nunca pode ser true. É essa garantia que impede "erro de rede" de acabar mostrando
// "os documentos estão sendo atualizados" em vez da mensagem de erro real.
test('isLegalPolicyOutdated is never true while access is unknown (covers the network-error path)', () => {
  assert.equal(isLegalPolicyOutdated(null, CURRENT), false)
  assert.equal(isLegalPolicyOutdated(undefined, CURRENT), false)
})

// Cenário 4 e 5: com a policy em dia, quem decide entre "tela de reaceite" e "app
// liberado" é needsLegalAcceptance -- confirmando o comportamento já existente (não
// alterado nesta correção) para as duas pontas.
test('needsLegalAcceptance: an outdated acceptance still requires re-accepting (cenário 4)', () => {
  assert.equal(
    needsLegalAcceptance({ version: '1.2.0', acceptedAt: {} }, CURRENT),
    true
  )
})

test('needsLegalAcceptance: no acceptance at all also requires accepting', () => {
  assert.equal(needsLegalAcceptance(null, CURRENT), true)
  assert.equal(needsLegalAcceptance(undefined, CURRENT), true)
})

test('needsLegalAcceptance: a current acceptance releases the app (cenário 5)', () => {
  assert.equal(
    needsLegalAcceptance({ version: CURRENT, acceptedAt: {} }, CURRENT),
    false
  )
})

test('isAccountRestricted: no restriction, an expired suspension, and a system ban', () => {
  assert.equal(isAccountRestricted(null), false)
  assert.equal(
    isAccountRestricted(
      { action: 'temporary_suspension', until: new Date(Date.now() - 1000) },
      Date.now()
    ),
    false
  )
  assert.equal(
    isAccountRestricted(
      { action: 'temporary_suspension', until: new Date(Date.now() + 86400000) },
      Date.now()
    ),
    true
  )
  assert.equal(isAccountRestricted({ action: 'system_ban' }), true)
})
