import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { checkMigrationIntegrity } from './check-migration-integrity.mjs'
const name = '20261205000001_history.sql',
  source = 'select 1;\n'
const baseline = { [name]: createHash('sha256').update(source).digest('hex') }
test('migration gate accepts unchanged history and a forward additive migration', () => {
  assert.deepEqual(
    checkMigrationIntegrity({ [name]: source, '20261206000001_guard.sql': 'select 2;' }, baseline),
    { passed: true, migrations: 2, historical: 1 }
  )
})
test('migration gate fails closed on history tampering or removal', () => {
  assert.throws(
    () => checkMigrationIntegrity({ [name]: 'select 0;' }, baseline),
    /HISTORICAL_MIGRATION_CHANGED/
  )
  assert.throws(() => checkMigrationIntegrity({}, baseline), /HISTORICAL_MIGRATION_REMOVED/)
})
test('migration gate rejects duplicate versions, backdating and empty sources', () => {
  assert.throws(
    () =>
      checkMigrationIntegrity(
        { [name]: source, '20261205000001_other.sql': 'select 2;' },
        baseline
      ),
    /DUPLICATE/
  )
  assert.throws(
    () =>
      checkMigrationIntegrity({ [name]: source, '20261204000001_late.sql': 'select 2;' }, baseline),
    /BACKDATED/
  )
  assert.throws(
    () => checkMigrationIntegrity({ [name]: source, '20261206000001_empty.sql': '' }, baseline),
    /INVALID/
  )
})
