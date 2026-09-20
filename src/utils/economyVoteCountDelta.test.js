import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  economyVoteCountDelta,
  applyEconomyVoteCountDelta,
  applyEconomyVoteCountDeltaToList,
} from './economyVoteCountDelta.js'

test('economyVoteCountDelta: null -> positive is +1 positive, 0 negative', () => {
  assert.deepEqual(economyVoteCountDelta(null, 1), { positiveDelta: 1, negativeDelta: 0 })
})

test('economyVoteCountDelta: null -> negative is +1 negative, 0 positive', () => {
  assert.deepEqual(economyVoteCountDelta(null, -1), { positiveDelta: 0, negativeDelta: 1 })
})

test('economyVoteCountDelta: positive -> negative moves one from each side', () => {
  assert.deepEqual(economyVoteCountDelta(1, -1), { positiveDelta: -1, negativeDelta: 1 })
})

test('economyVoteCountDelta: negative -> positive moves one from each side', () => {
  assert.deepEqual(economyVoteCountDelta(-1, 1), { positiveDelta: 1, negativeDelta: -1 })
})

test('economyVoteCountDelta: positive -> null (remove) is -1 positive, 0 negative', () => {
  assert.deepEqual(economyVoteCountDelta(1, null), { positiveDelta: -1, negativeDelta: 0 })
})

test('economyVoteCountDelta: negative -> null (remove) is -1 negative, 0 positive', () => {
  assert.deepEqual(economyVoteCountDelta(-1, null), { positiveDelta: 0, negativeDelta: -1 })
})

test('economyVoteCountDelta: same value twice (noop) is a zero delta', () => {
  assert.deepEqual(economyVoteCountDelta(1, 1), { positiveDelta: 0, negativeDelta: 0 })
  assert.deepEqual(economyVoteCountDelta(null, null), { positiveDelta: 0, negativeDelta: 0 })
})

test('applyEconomyVoteCountDelta: never lets a counter go below zero', () => {
  const status = { id: 's1', positiveVoteCount: 0, negativeVoteCount: 0 }
  const result = applyEconomyVoteCountDelta(status, { positiveDelta: -1, negativeDelta: -1 })
  assert.equal(result.positiveVoteCount, 0)
  assert.equal(result.negativeVoteCount, 0)
})

test('applyEconomyVoteCountDelta: missing counters (post anterior ao recurso) default to 0 before applying the delta', () => {
  const status = { id: 's1' }
  const result = applyEconomyVoteCountDelta(status, { positiveDelta: 1, negativeDelta: 0 })
  assert.equal(result.positiveVoteCount, 1)
  assert.equal(result.negativeVoteCount, 0)
})

test('applyEconomyVoteCountDelta: never mutates the original status object', () => {
  const status = { id: 's1', positiveVoteCount: 1, negativeVoteCount: 0 }
  applyEconomyVoteCountDelta(status, { positiveDelta: 1, negativeDelta: 0 })
  assert.equal(status.positiveVoteCount, 1, 'objeto original não deveria ter sido alterado')
})

test('applyEconomyVoteCountDeltaToList: only the matching status changes, the rest keep their same reference', () => {
  const other = { id: 's2', positiveVoteCount: 5, negativeVoteCount: 5 }
  const list = [{ id: 's1', positiveVoteCount: 0, negativeVoteCount: 0 }, other]
  const next = applyEconomyVoteCountDeltaToList(list, 's1', { positiveDelta: 1, negativeDelta: 0 })
  assert.equal(next[0].positiveVoteCount, 1)
  assert.equal(next[1], other, 'item não afetado mantém a mesma referência')
})

test('applyEconomyVoteCountDeltaToList: statusId ausente da lista devolve a MESMA referência de array (no-op, nunca refetch)', () => {
  const list = [{ id: 's1', positiveVoteCount: 0, negativeVoteCount: 0 }]
  const next = applyEconomyVoteCountDeltaToList(list, 'never-there', { positiveDelta: 1, negativeDelta: 0 })
  assert.equal(next, list)
})

test('applyEconomyVoteCountDeltaToList: mesmo statusId presente em duas listas diferentes (statuses + featuredStatuses) recebe o mesmo tratamento em cada uma', () => {
  const statuses = [{ id: 'shared', positiveVoteCount: 0, negativeVoteCount: 0 }]
  const featuredStatuses = [{ id: 'shared', positiveVoteCount: 0, negativeVoteCount: 0 }]
  const delta = { positiveDelta: 1, negativeDelta: 0 }
  const nextStatuses = applyEconomyVoteCountDeltaToList(statuses, 'shared', delta)
  const nextFeatured = applyEconomyVoteCountDeltaToList(featuredStatuses, 'shared', delta)
  assert.equal(nextStatuses[0].positiveVoteCount, 1)
  assert.equal(nextFeatured[0].positiveVoteCount, 1, 'a cópia destacada do mesmo post também precisa refletir o novo número')
})
