import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ADMIN_ACTIONS,
  BLOCK_REASON_LABELS,
  DELETION_STATE_LABELS,
  REVIEW_RESULT_LABELS,
  SEPARATED_CASE_MESSAGE,
  describeDeletionProgress,
} from './accountDeletion.js'

test('in financial review the review step is current and deletion has not started', () => {
  const progress = describeDeletionProgress({
    state: 'blocked_financial_review',
    financialCaseSeparated: false,
  })
  assert.equal(progress.headline, 'Exclusão em análise')
  assert.equal(progress.situation, 'Em revisão financeira')
  assert.deepEqual(
    progress.steps.map((step) => [step.key, step.status]),
    [
      ['requested', 'done'],
      ['financial_review', 'current'],
      ['deletion', 'todo'],
    ]
  )
  assert.equal(progress.separatedMessage, null)
})

test('after the case is separated the deletion step is current and the user gets the separated-process message', () => {
  const progress = describeDeletionProgress({ state: 'pending', financialCaseSeparated: true })
  assert.equal(progress.situation, 'Exclusão em andamento')
  assert.deepEqual(
    progress.steps.map((step) => [step.key, step.status]),
    [
      ['requested', 'done'],
      ['financial_review', 'done'],
      ['case_separated', 'done'],
      ['deletion', 'current'],
    ]
  )
  assert.equal(
    progress.separatedMessage,
    'Seu processo financeiro continuará sendo tratado separadamente. A exclusão da conta seguirá normalmente.'
  )
  assert.equal(progress.separatedMessage, SEPARATED_CASE_MESSAGE)
})

test('the user-facing progress never carries any financial value', () => {
  const text = JSON.stringify(
    describeDeletionProgress({ state: 'pending', financialCaseSeparated: true })
  )
  assert.doesNotMatch(text, /saldo|R\$|EvoCash/i)
})

test('every deletion_jobs state and review result produced by the database has a label', () => {
  for (const state of ['pending', 'blocked_financial_review', 'complete', 'cancelled']) {
    assert.ok(DELETION_STATE_LABELS[state], state)
  }
  for (const result of ['resumed', 'still_blocked', 'case_separated', 'cancelled']) {
    assert.ok(REVIEW_RESULT_LABELS[result], result)
  }
  for (const reason of ['pending_cash_purchase', 'positive_cash_balance']) {
    assert.ok(BLOCK_REASON_LABELS[reason], reason)
  }
})

test('there is no force-delete admin action and the separation copy states what it does not do', () => {
  assert.deepEqual(Object.keys(ADMIN_ACTIONS).sort(), ['cancel', 'revalidate', 'separate'])
  const separate = ADMIN_ACTIONS.separate.description
  assert.match(separate, /NÃO zera o EvoCash/)
  assert.match(separate, /NÃO apaga o ledger/)
  assert.match(separate, /irreversível/)
})
