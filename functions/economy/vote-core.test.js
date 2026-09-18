import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateVoteOnPost, decideVoteAction, nextRewardState } from './vote-core.js'

test('validateVoteOnPost accepts 1, -1 and null, with a valid statusId', () => {
  for (const value of [1, -1, null]) {
    assert.equal(validateVoteOnPost({ statusId: 'abc123', value }), null)
  }
})

test('validateVoteOnPost rejects a malformed statusId regardless of value', () => {
  assert.ok(validateVoteOnPost({ statusId: '', value: 1 }))
  assert.ok(validateVoteOnPost({ statusId: undefined, value: 1 }))
  assert.ok(validateVoteOnPost({ statusId: 'has spaces', value: 1 }))
})

test('validateVoteOnPost rejects any value other than 1, -1 or null', () => {
  for (const value of [0, 2, -2, '1', undefined, true, NaN]) {
    assert.ok(validateVoteOnPost({ statusId: 'abc123', value }))
  }
})

test('no existing vote + a real value (1 or -1) -> create', () => {
  assert.equal(decideVoteAction({ existingVote: null, incomingValue: 1 }).action, 'create')
  assert.equal(decideVoteAction({ existingVote: undefined, incomingValue: -1 }).action, 'create')
})

test('no existing vote + null (nothing to remove) -> noop', () => {
  assert.equal(decideVoteAction({ existingVote: null, incomingValue: null }).action, 'noop')
})

test('existing vote + the exact same value again (accidental double click) -> noop', () => {
  assert.equal(
    decideVoteAction({ existingVote: { value: 1 }, incomingValue: 1 }).action,
    'noop'
  )
  assert.equal(
    decideVoteAction({ existingVote: { value: -1 }, incomingValue: -1 }).action,
    'noop'
  )
})

test('existing vote + the opposite value -> switch (no new charge)', () => {
  assert.equal(
    decideVoteAction({ existingVote: { value: 1 }, incomingValue: -1 }).action,
    'switch'
  )
  assert.equal(
    decideVoteAction({ existingVote: { value: -1 }, incomingValue: 1 }).action,
    'switch'
  )
})

test('existing active vote + null -> remove (no refund)', () => {
  assert.equal(
    decideVoteAction({ existingVote: { value: 1 }, incomingValue: null }).action,
    'remove'
  )
})

test('existing vote already removed (value: null) + a real value again -> switch (already charged once, never recharged)', () => {
  assert.equal(
    decideVoteAction({ existingVote: { value: null }, incomingValue: 1 }).action,
    'switch'
  )
})

test('nextRewardState: a fresh positive vote is pending; negative or removed are ineligible', () => {
  assert.equal(nextRewardState(null, 1), 'pending')
  assert.equal(nextRewardState(null, -1), 'ineligible')
  assert.equal(nextRewardState(null, null), 'ineligible')
  assert.equal(nextRewardState(undefined, 1), 'pending')
})

// Máquina de estados completa de rewardState (seção 15 do prompt de economia + a
// permanência de 'processed' adicionada nesta auditoria). Três estados possíveis --
// 'pending', 'ineligible', 'processed' -- e as transições abaixo são as ÚNICAS que
// nextRewardState permite; qualquer combinação (estado atual, valor recebido) cai em
// exatamente uma destas linhas.

test('pending -- negativo -> ineligible', () => {
  assert.equal(nextRewardState('pending', -1), 'ineligible')
})

test('pending -- removido (null) -> ineligible', () => {
  assert.equal(nextRewardState('pending', null), 'ineligible')
})

test('pending -- positivo de novo -> permanece pending', () => {
  assert.equal(nextRewardState('pending', 1), 'pending')
})

test('ineligible -- positivo -> pending', () => {
  assert.equal(nextRewardState('ineligible', 1), 'pending')
})

test('ineligible -- negativo de novo -> permanece ineligible', () => {
  assert.equal(nextRewardState('ineligible', -1), 'ineligible')
})

test('ineligible -- removido (null) -> permanece ineligible', () => {
  assert.equal(nextRewardState('ineligible', null), 'ineligible')
})

// 'processed' (settlement já creditou o autor) é um estado absorvente: qualquer entrada
// (1, -1 ou null) devolve 'processed'. Sem isso, trocar pra negativo e voltar pra
// positivo recomputaria 'pending' num voto já creditado, arriscando crédito duplicado
// num reprocessamento futuro.
test('processed -- qualquer alteração (positivo, negativo ou remoção) -> permanece processed', () => {
  assert.equal(nextRewardState('processed', 1), 'processed')
  assert.equal(nextRewardState('processed', -1), 'processed')
  assert.equal(nextRewardState('processed', null), 'processed')
})

// 'capped' (settlement decidiu que este voto nunca vai gerar crédito -- limite
// econômico estourado, publicação removida, autor banido/excluído) é IGUALMENTE
// absorvente. Sem isso, um voto rejeitado por limite hoje poderia "ressuscitar" como
// pending amanhã só porque o votante trocou de direção e voltou, mesmo a decisão
// definitiva já ter sido tomada.
test('capped -- qualquer alteração (positivo, negativo ou remoção) -> permanece capped', () => {
  assert.equal(nextRewardState('capped', 1), 'capped')
  assert.equal(nextRewardState('capped', -1), 'capped')
  assert.equal(nextRewardState('capped', null), 'capped')
})

// 'deferred' (autor com suspensão temporária ativa no momento do settlement) é
// TRANSITÓRIO, ao contrário de processed/capped -- o settlement pode reverter isto por
// conta própria (promoção quando a suspensão acaba), e o votante pode cancelar a
// oportunidade a qualquer momento trocando de direção ou removendo o voto, exatamente
// como faria com um voto 'pending' comum.
test('deferred -- negativo ou removido pelo votante -> ineligible (cancela a oportunidade)', () => {
  assert.equal(nextRewardState('deferred', -1), 'ineligible')
  assert.equal(nextRewardState('deferred', null), 'ineligible')
})
