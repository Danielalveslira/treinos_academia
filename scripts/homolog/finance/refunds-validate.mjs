import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
const container = 'evolutus_refunds_db'
const evidence = 'docs/finance-restructure/refunds/evidence'
mkdirSync(evidence, { recursive: true })
const docker = (args, input) => {
  try {
    return execFileSync('docker', args, {
      input,
      encoding: 'utf8',
      maxBuffer: 8e6,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (e) {
    writeFileSync(evidence + '/failure.log', String(e.stdout) + '\n' + String(e.stderr))
    console.error(String(e.stderr))
    process.exit(1)
  }
}
docker(['cp', 'supabase/tests/.', container + ':/tmp/refund-tests'])
const suites = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'refund_requests_test.sql',
      'refund_exceptions_test.sql',
      'refund_services_test.sql',
      'refund_chargeback_test.sql',
      'finance_reversals_test.sql',
      'finance_integrity_test.sql',
      'commercial_engine_test.sql',
      'evocash_pricing_test.sql',
      'infinitepay_cash_purchases_test.sql',
      'advertising_campaigns_test.sql',
    ]
const results = []
for (const name of suites) {
  if (!/^[a-z0-9_]+_test.sql$/.test(name)) throw Error('INVALID_LOCAL_SUITE')
  const out = docker(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-X',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    "begin;create extension if not exists pgtap with schema extensions;delete from public.legal_policy;update private.refund_settings set financial_requests_enabled=false,settlement_enabled=false where id;update public.economy_config set config=jsonb_set(config,'{financialControls,reversalsEnabled}','false') where id;truncate public.refund_settlements,public.refund_request_events,public.refund_requests,public.refund_contract_terms,private.refund_quote_terms;\n\\i /tmp/refund-tests/" +
      name +
      '\n'
  )
  writeFileSync(evidence + '/' + name.replace('.sql', '.log'), out)
  const count = [...out.matchAll(/^ok \d+\b/gm)].length,
    plan = [...out.matchAll(/^1\.\.(\d+)$/gm)].at(-1)
  if (/^not ok\b/m.test(out) || !plan || count !== Number(plan[1])) {
    console.log(out)
    throw Error('FAILED ' + name)
  }
  results.push({ name, assertions: count, passed: true })
}
writeFileSync(evidence + '/sql-summary.json', JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results))
