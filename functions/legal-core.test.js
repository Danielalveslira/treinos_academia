import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  legalDigest,
  validateAcceptance,
  calculateAge,
  requestIp,
  validId,
  validateSupportRequest,
  validateDecision,
} from './legal-core.js'

const publishedManifest = {
  published: true,
  controllerName: 'Treinos LTDA',
  contactEmail: 'contato@treinos.app',
  version: '1.0.0',
}

test('legalDigest is stable for the same input and changes when content changes', () => {
  const manifest = { version: '1.0.0' }
  const documents = [{ id: 'terms' }]
  const digest = legalDigest(manifest, documents)
  assert.equal(digest, legalDigest(manifest, documents))
  assert.notEqual(digest, legalDigest({ version: '1.0.1' }, documents))
})

test('validateAcceptance blocks while the manifest is not published or incomplete', () => {
  assert.match(
    validateAcceptance({}, { published: false, controllerName: '', contactEmail: '' }),
    /revisão/
  )
  assert.match(
    validateAcceptance({}, { published: true, controllerName: '', contactEmail: 'a@b.com' }),
    /revisão/
  )
})

test('validateAcceptance requires the current version and every confirmation', () => {
  assert.match(validateAcceptance({ version: '0.9.0' }, publishedManifest), /versão mudou/i)
  assert.equal(
    validateAcceptance(
      { version: '1.0.0', accepted: true, healthDataConsent: true },
      publishedManifest
    ),
    null
  )
  assert.match(
    validateAcceptance(
      { version: '1.0.0', accepted: true, healthDataConsent: false },
      publishedManifest
    ),
    /Confirme/
  )
})

// A idade mínima não é mais checada aqui (nem por um "ageConfirmed" autodeclarado) —
// isso agora vive em acceptLegalDocuments (index.js), a partir de users/{uid}.dataNascimento
// já gravado, calculado por esta mesma calculateAge. Ver também src/utils/age.js
// (mesma lógica, runtime do navegador — sem pacote compartilhado entre os dois).
test('calculateAge counts full years, only crediting the birthday once it has actually passed, and reads Firestore Timestamps', () => {
  const now = new Date(2026, 8, 10) // 2026-09-10
  assert.equal(calculateAge(new Date(2000, 8, 10), now), 26)
  assert.equal(calculateAge(new Date(2000, 8, 11), now), 25)
  assert.equal(calculateAge({ toDate: () => new Date(2008, 0, 1) }, now), 18)
})

test('requestIp reads the IP resolved by the Firebase infrastructure, never from the payload', () => {
  assert.equal(requestIp({ rawRequest: { ip: '203.0.113.10' } }), '203.0.113.10')
  assert.throws(() => requestIp({ rawRequest: { ip: 'not-an-ip' } }))
  assert.throws(() => requestIp({ rawRequest: {} }))
})

test('validId only accepts short alphanumeric/dash/underscore ids', () => {
  assert.equal(validId('abc-123_XYZ'), true)
  assert.equal(validId(''), false)
  assert.equal(validId('a'.repeat(129)), false)
  assert.equal(validId('has spaces'), false)
  assert.equal(validId(42), false)
})

test('validateSupportRequest enforces kind, message length and id shape', () => {
  assert.match(validateSupportRequest({ kind: 'bogus', message: 'x'.repeat(20) }), /Tipo inválido/)
  assert.match(validateSupportRequest({ kind: 'report', message: 'curto' }), /10 e 3\.000/)
  assert.equal(
    validateSupportRequest({ kind: 'report', message: 'x'.repeat(20), statusId: 'abc-1' }),
    null
  )
  assert.match(
    validateSupportRequest({ kind: 'report', message: 'x'.repeat(20), statusId: 'has space' }),
    /Referência inválida/
  )
  assert.match(
    validateSupportRequest({ kind: 'appeal', message: 'x'.repeat(20) }),
    /protocolo da decisão/
  )
})

test('validateDecision rejects unknown actions and undersized justification fields', () => {
  const base = {
    requestId: 'req-1',
    action: 'no_action',
    reason: 'motivo detalhado aqui',
    rule: 'regra 2',
    evidence: 'print anexado',
  }
  assert.equal(validateDecision(base), null)
  assert.match(validateDecision({ ...base, action: 'not_a_real_action' }), /Decisão inválida/)
  assert.match(validateDecision({ ...base, reason: 'oi' }), /regra, evidências/)
})

test('validateDecision exempts no_action/remove_content from requiring a target user, others need one', () => {
  const base = {
    requestId: 'req-1',
    reason: 'motivo detalhado aqui',
    rule: 'regra 2',
    evidence: 'print anexado',
  }
  assert.equal(validateDecision({ ...base, action: 'no_action' }), null)
  assert.equal(validateDecision({ ...base, action: 'remove_content' }), null)
  assert.match(validateDecision({ ...base, action: 'warning' }), /usuário atingido/)
})

test('validateDecision bounds temporary_suspension to 1-30 days and requires communityId for community_ban', () => {
  const base = {
    requestId: 'req-1',
    reason: 'motivo detalhado aqui',
    rule: 'regra 2',
    evidence: 'print anexado',
    targetUserId: 'user-1',
  }
  assert.match(
    validateDecision({ ...base, action: 'temporary_suspension', days: 0 }),
    /entre 1 e 30 dias/
  )
  assert.match(
    validateDecision({ ...base, action: 'temporary_suspension', days: 31 }),
    /entre 1 e 30 dias/
  )
  assert.equal(validateDecision({ ...base, action: 'temporary_suspension', days: 7 }), null)
  assert.match(validateDecision({ ...base, action: 'community_ban' }), /Informe a comunidade/)
  assert.equal(validateDecision({ ...base, action: 'community_ban', communityId: 'gym-1' }), null)
})

test('validateDecision rejects a malformed communityId regardless of action, before it reaches a Firestore path', () => {
  const base = {
    requestId: 'req-1',
    reason: 'motivo detalhado aqui',
    rule: 'regra 2',
    evidence: 'print anexado',
  }
  // communityId com "/" (ou outro formato inválido) usado num caminho do Firestore
  // (deletionJobs/community_${communityId}) antes de qualquer checagem específica de
  // ação, em decideSupportRequest — precisa ser barrado aqui, não só para
  // community_ban/restore, senão vira um erro interno do db.doc() em vez de uma
  // mensagem de validação limpa.
  assert.match(
    validateDecision({ ...base, action: 'no_action', communityId: 'gym/evil' }),
    /Comunidade inválida/
  )
  assert.match(
    validateDecision({ ...base, action: 'remove_content', communityId: 'gym/evil' }),
    /Comunidade inválida/
  )
  // communityId ausente ou vazio continua permitido para ações que não o exigem.
  assert.equal(validateDecision({ ...base, action: 'no_action' }), null)
  assert.equal(validateDecision({ ...base, action: 'no_action', communityId: '' }), null)
})
