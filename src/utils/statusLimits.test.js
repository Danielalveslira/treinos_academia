import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STATUS_TEXT_MAX_LENGTH } from './statusLimits.js'

// O frontend nunca pode permitir mais do que o banco aceita: lê o limite da migration mais recente que mexe em
// statuses_text_check e compara.
function latestMigrationLimit() {
  const url = new URL(
    '../../supabase/migrations/20261017000003_status_text_limit_7000.sql',
    import.meta.url
  )
  const match = /char_length\(text\) between 1 and (\d+)/.exec(readFileSync(url, 'utf8'))
  return Number(match?.[1])
}

test('o limite do frontend nunca passa do que a migration mais recente permite', () => {
  const dbLimit = latestMigrationLimit()
  assert.ok(Number.isInteger(dbLimit) && dbLimit > 0, 'limite lido da migration')
  assert.ok(
    STATUS_TEXT_MAX_LENGTH <= dbLimit,
    `frontend (${STATUS_TEXT_MAX_LENGTH}) <= banco (${dbLimit})`
  )
})

test('o limite é um inteiro positivo e razoável', () => {
  assert.ok(Number.isInteger(STATUS_TEXT_MAX_LENGTH))
  assert.ok(STATUS_TEXT_MAX_LENGTH >= 500 && STATUS_TEXT_MAX_LENGTH <= 7000)
})
