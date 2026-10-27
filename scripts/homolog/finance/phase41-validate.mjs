import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const evidence = 'docs/finance-restructure/phase4/evidence41'
mkdirSync(evidence, { recursive: true })
const container = 'evolutus_price_phase1_db'
execFileSync('docker', ['cp', 'supabase/tests/.', container + ':/tmp/commercial-phase3-tests'], {
  stdio: 'pipe',
})
const suites = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'storefront_revisions_test.sql',
      'product_storefronts_test.sql',
      'commercial_engine_test.sql',
      'evocash_pricing_test.sql',
      'infinitepay_cash_purchases_test.sql',
      'finance_integrity_test.sql',
      'finance_reversals_test.sql',
      'public_commercial_test.sql',
      'partner_products_require_image_test.sql',
    ]
const results = []
for (const name of suites) {
  if (!/^[a-z0-9_]+_test.sql$/.test(name)) throw Error('Invalid test file')
  const output = execFileSync(
    'docker',
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
    {
      input:
        'begin;delete from public.legal_policy;\n\\i /tmp/commercial-phase3-tests/' + name + '\n',
      encoding: 'utf8',
      maxBuffer: 8000000,
    }
  )
  writeFileSync(evidence + '/' + name.replace('.sql', '.log'), output)
  const count = [...output.matchAll(/^ok \d+\b/gm)].length
  const plan = [...output.matchAll(/^1\.\.(\d+)$/gm)].at(-1)
  if (/^not ok\b/m.test(output) || !plan || count !== Number(plan[1])) {
    console.log(output)
    throw Error('Failed ' + name)
  }
  results.push({ name, passed: true, assertions: count })
}
writeFileSync(evidence + '/sql-summary.json', JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results))
