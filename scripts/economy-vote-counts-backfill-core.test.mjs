import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBackfillArgs, runEconomyVoteCountsBackfill } from './economy-vote-counts-backfill-core.mjs'

test('parseBackfillArgs defaults to dry-run and only accepts --apply', () => {
  assert.deepEqual(parseBackfillArgs([]), { apply: false })
  assert.deepEqual(parseBackfillArgs(['--apply']), { apply: true })
  assert.throws(() => parseBackfillArgs(['--bogus']))
})

test('dry-run never calls countVotesByValue/applyCounts, even when there is work to do', async () => {
  const calls = []
  const result = await runEconomyVoteCountsBackfill({
    apply: false,
    listStatusIdsMissingCounts: async () => ['s1', 's2'],
    countVotesByValue: async () => calls.push('count'),
    applyCounts: async () => calls.push('apply'),
  })
  assert.deepEqual(result, { mode: 'DRY-RUN', total: 2, written: 0, failed: 0 })
  assert.deepEqual(calls, [])
})

test('apply recomputes and writes counts only for the statuses reported as missing them', async () => {
  const applied = {}
  const result = await runEconomyVoteCountsBackfill({
    apply: true,
    listStatusIdsMissingCounts: async () => ['s1', 's2'],
    countVotesByValue: async (statusId) => ({ positive: statusId === 's1' ? 3 : 0, negative: 1 }),
    applyCounts: async (statusId, counts) => {
      applied[statusId] = counts
    },
  })
  assert.deepEqual(result, { mode: 'APPLY', total: 2, written: 2, failed: 0 })
  assert.deepEqual(applied, { s1: { positive: 3, negative: 1 }, s2: { positive: 0, negative: 1 } })
})

test('apply keeps going after a per-status failure, and reports it instead of throwing mid-loop', async () => {
  const applied = {}
  await assert.rejects(
    runEconomyVoteCountsBackfill({
      apply: true,
      listStatusIdsMissingCounts: async () => ['ok1', 'broken', 'ok2'],
      countVotesByValue: async (statusId) => {
        if (statusId === 'broken') throw new Error('aggregation falhou')
        return { positive: 1, negative: 0 }
      },
      applyCounts: async (statusId, counts) => {
        applied[statusId] = counts
      },
    }),
    /Backfill incompleto: 1/
  )
  assert.deepEqual(Object.keys(applied).sort(), ['ok1', 'ok2'])
})

test('nothing to do (no status missing the counters) is a no-op even in apply mode', async () => {
  const result = await runEconomyVoteCountsBackfill({
    apply: true,
    listStatusIdsMissingCounts: async () => [],
    countVotesByValue: async () => {
      throw new Error('não deveria ser chamado')
    },
    applyCounts: async () => {
      throw new Error('não deveria ser chamado')
    },
  })
  assert.deepEqual(result, { mode: 'APPLY', total: 0, written: 0, failed: 0 })
})
