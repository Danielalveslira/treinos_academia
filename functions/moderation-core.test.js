import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isProtectedRole, isSelfReport, buildAutomatedSuspension } from './moderation-core.js'

test('superadmin and admin roles are protected from reports and penalties', () => {
  assert.equal(isProtectedRole('superadmin'), true)
  assert.equal(isProtectedRole('admin'), true)
})

test('regular users and missing/forged roles are not protected', () => {
  assert.equal(isProtectedRole('user'), false)
  assert.equal(isProtectedRole(undefined), false)
  assert.equal(isProtectedRole(''), false)
  assert.equal(isProtectedRole('superadmin '), false)
})

test('a user reporting their own publication is a self-report', () => {
  assert.equal(isSelfReport('owner', 'owner'), true)
  assert.equal(isSelfReport('owner', 'visitor'), false)
  assert.equal(isSelfReport(undefined, undefined), true)
})

test('buildAutomatedSuspension matches the decideSupportRequest shape, marked as automated', () => {
  const { decision, notice, restriction } = buildAutomatedSuspension({
    authorId: 'spammer',
    decisionId: 'decision1',
    windowCount: 9,
    windowMinutes: 10,
  })
  assert.equal(decision.adminId, 'system')
  assert.equal(decision.automated, true)
  assert.equal(decision.targetUserId, 'spammer')
  assert.equal(decision.action, 'temporary_suspension')
  assert.match(decision.reason, /9 publicações em menos de 10 minutos/)
  // notice é o que faz "Recorrer desta decisão" aparecer em /atendimento (ver
  // Support.jsx) -- sem ele, a restrição automática ficaria muda e sem recurso.
  assert.equal(notice.action, 'temporary_suspension')
  assert.equal(notice.reason, decision.reason)
  // restriction é o que statusAccountOk() de fato lê em firestore.rules; decisionId
  // precisa apontar pro mesmo documento de moderationDecisions criado acima, pra
  // submitSupportRequest(kind: 'appeal') validar o recurso contra ele.
  assert.equal(restriction.action, 'temporary_suspension')
  assert.equal(restriction.decisionId, 'decision1')
})
