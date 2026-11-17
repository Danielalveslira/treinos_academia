// Run from the trusted base revision. A skipped job is accepted only when the plan omitted it.
export function evaluateGate({ event, draft, scope, plan, jobs, eventHead, eventBase }) {
  if (scope !== 'success') throw new Error('CI_SCOPE_FAILED')
  if (!plan || !/^[a-f0-9]{40}$/.test(plan.head_sha) || plan.head_sha !== eventHead)
    throw new Error('CI_PLAN_HEAD_MISMATCH')
  if (!/^[a-f0-9]{40}$/.test(plan.base_sha) || plan.base_sha !== eventBase)
    throw new Error('CI_PLAN_BASE_MISMATCH')
  if (typeof plan.run_js !== 'boolean' || typeof plan.run_sql !== 'boolean' ||
      typeof plan.run_finance !== 'boolean' || typeof plan.browser_base !== 'boolean' ||
      typeof plan.browser_catalog !== 'boolean' || typeof plan.browser_full !== 'boolean')
    throw new Error('CI_PLAN_INVALID')
  if (plan.draft !== Boolean(draft)) throw new Error('CI_DRAFT_MISMATCH')
  if (draft) throw new Error('DRAFT_REQUIRES_READY_REVIEW')
  if (event !== 'pull_request' && (!plan.run_js || !plan.run_sql || !plan.run_finance))
    throw new Error('MAIN_REQUIRES_FULL_CI')
  for (const [name, required] of Object.entries({ js: plan.run_js, sql: plan.run_sql,
    'finance-e2e': plan.run_finance, secrets: true })) {
    const actual = jobs[name]
    if (actual !== (required ? 'success' : 'skipped'))
      throw new Error(`CI_JOB_${name}_${required ? 'REQUIRED' : 'DISPENSED'}_${actual || 'MISSING'}`)
  }
  return true
}

if (process.argv[1]?.endsWith('/quality-gate.mjs') && process.env.CI_PLAN_JSON) {
  evaluateGate({
    event: process.env.CI_EVENT,
    draft: process.env.CI_DRAFT === 'true',
    scope: process.env.CI_SCOPE_RESULT,
    plan: JSON.parse(process.env.CI_PLAN_JSON),
    eventHead: process.env.CI_HEAD_SHA,
    eventBase: process.env.CI_BASE_SHA,
    jobs: {
      js: process.env.CI_JS_RESULT,
      sql: process.env.CI_SQL_RESULT,
      'finance-e2e': process.env.CI_FINANCE_RESULT,
      secrets: process.env.CI_SECRETS_RESULT,
    },
  })
  process.stdout.write('CI_GATE_OK\n')
}
