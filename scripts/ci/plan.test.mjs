import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, parseNameStatus } from './plan.mjs'
import { evaluateGate } from './quality-gate.mjs'
const sha = 'a'.repeat(40)
const change = (...paths) => paths.map((path) => ({ status: 'M', paths: [path] }))
const plan = (paths, draft = false) => ({ ...classify(change(...paths), { draft }), head_sha: sha, base_sha: sha })
const pass = (p, overrides = {}) => ({ event: 'pull_request', draft: p.draft, scope: 'success',
  plan: p, eventHead: sha, eventBase: sha, jobs: { js: p.run_js ? 'success' : 'skipped',
    sql: p.run_sql ? 'success' : 'skipped', 'finance-e2e': p.run_finance ? 'success' : 'skipped',
    secrets: 'success' }, ...overrides })
const browserSuites = (p) => ({
  workoutSheetsAndHomeAndOffline: p.browser_base,
  phase3Exercises: p.browser_catalog,
  fullOnlySmokes: p.browser_full,
})

test('documentation only legitimately dispenses heavy jobs', () => {
  const p = plan(['docs/ci/ESTRATEGIA_CI_ECONOMICO.md'])
  assert.equal(p.run_js, false)
  assert.equal(evaluateGate(pass(p)), true)
})
test('isolated sheet CSS runs JS and the full visual matrix, no SQL', () => {
  const p = plan(['src/features/workoutSheets/workoutSheets.css'])
  assert.deepEqual(browserSuites(p), { workoutSheetsAndHomeAndOffline: true, phase3Exercises: true, fullOnlySmokes: true })
  assert.equal(p.run_sql, false)
})
test('shared component, finance, advertising, security, migration, dependencies and CI all run full', () => {
  for (const path of ['src/components/Layout.jsx', 'src/services/evocashService.js',
    'src/components/advertising/AdStatusCard.jsx', 'supabase/functions/auth/index.ts',
    'supabase/migrations/20261222000007_a.sql', 'package-lock.json',
    '.github/workflows/supabase-tests.yml', 'scripts/ci/plan.mjs']) {
    const p = plan([path])
    assert.deepEqual([p.run_js, p.run_sql, p.run_finance], [true, true, true], path)
  }
})
test('catalog and sheets use their own scoped matrix in isolation', () => {
  const catalogOnly = plan(['src/utils/exerciseCatalog.js'])
  assert.deepEqual(browserSuites(catalogOnly), { workoutSheetsAndHomeAndOffline: true, phase3Exercises: true, fullOnlySmokes: false })
  assert.equal(catalogOnly.run_sql, false)
  const sheetsOnly = plan(['src/features/workoutSheets/WorkoutSheetEditorPage.jsx'])
  assert.deepEqual(browserSuites(sheetsOnly), { workoutSheetsAndHomeAndOffline: true, phase3Exercises: false, fullOnlySmokes: false })
  assert.equal(sheetsOnly.run_sql, true)
})
test('a PR touching both catalog and sheets runs the true union of both matrices, not just the higher-priority one', () => {
  // Regression: an earlier implementation picked a single "highest priority" browser mode
  // (sheets over catalog), silently dropping phase3-exercises-browser-smoke.mjs for any PR
  // that also touched workoutSheets files -- exactly the catalog+sheets case here.
  const mixed = plan(['src/utils/exerciseCatalog.js', 'src/features/workoutSheets/WorkoutSheetEditorPage.jsx'])
  assert.deepEqual(browserSuites(mixed), { workoutSheetsAndHomeAndOffline: true, phase3Exercises: true, fullOnlySmokes: false })
  assert.equal(mixed.run_js, true)
  assert.equal(mixed.run_sql, true)
  assert.equal(mixed.run_finance, false)
})
test('a fully unrelated scope never turns on any browser suite', () => {
  const p = plan(['docs/ci/ESTRATEGIA_CI_ECONOMICO.md'])
  assert.deepEqual(browserSuites(p), { workoutSheetsAndHomeAndOffline: false, phase3Exercises: false, fullOnlySmokes: false })
})
test('unknown, removed and renamed paths fail safely to full', () => {
  assert.equal(plan(['new-unknown-file']).run_finance, true)
  const removed = parseNameStatus(Buffer.from('D\0supabase/migrations/old.sql\0'))
  assert.equal(classify(removed).run_finance, true)
  const renamed = parseNameStatus(Buffer.from('R100\0docs/old.md\0src/components/AdvertisingAdmin.jsx\0'))
  assert.equal(classify(renamed).run_finance, true)
})
test('malformed diff and empty scope block classification', () => {
  assert.throws(() => parseNameStatus(Buffer.from('M\0bad')), /INVALID_DIFF_ENCODING/)
  assert.throws(() => classify([]), /EMPTY_DIFF/)
})
test('required failed, cancelled or missing job blocks the gate', () => {
  const p = plan(['src/components/AdvertisingAdmin.jsx'])
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    const input = pass(p)
    input.jobs.sql = result
    assert.throws(() => evaluateGate(input), /CI_JOB_sql_REQUIRED/)
  }
})
test('legitimate skipped SQL and finance are accepted; a hidden run is rejected', () => {
  const p = plan(['docs/guide.md'])
  assert.equal(evaluateGate(pass(p)), true)
  const input = pass(p)
  input.jobs.sql = 'success'
  assert.throws(() => evaluateGate(input), /CI_JOB_sql_DISPENSED/)
})
test('draft cannot approve; ready review runs the classified checks', () => {
  const draft = plan(['docs/guide.md'], true)
  assert.throws(() => evaluateGate(pass(draft)), /DRAFT_REQUIRES_READY_REVIEW/)
  const ready = plan(['docs/guide.md'])
  assert.equal(evaluateGate(pass(ready)), true)
})
test('new commit invalidates previous plan and main always requires full CI', () => {
  const p = plan(['docs/guide.md'])
  assert.throws(() => evaluateGate(pass(p, { eventHead: 'b'.repeat(40) })), /CI_PLAN_HEAD_MISMATCH/)
  assert.throws(() => evaluateGate(pass(p, { eventBase: 'b'.repeat(40) })), /CI_PLAN_BASE_MISMATCH/)
  assert.throws(() => evaluateGate(pass(p, { event: 'push' })), /MAIN_REQUIRES_FULL_CI/)
  const full = plan(['.github/workflows/supabase-tests.yml'])
  assert.equal(evaluateGate(pass(full, { event: 'push' })), true)
})
test('scope failure and invalid plan fail closed', () => {
  const p = plan(['docs/guide.md'])
  assert.throws(() => evaluateGate(pass(p, { scope: 'failure' })), /CI_SCOPE_FAILED/)
  assert.throws(() => evaluateGate(pass(p, { plan: { ...p, run_js: 'false' } })), /CI_PLAN_INVALID/)
})
