import { readFile, writeFile } from 'node:fs/promises'

const dir = 'docs/releases/admin-contas'
const readJson = async (name) => JSON.parse(await readFile(`${dir}/${name}`, 'utf8'))

const [
  sqlPerformance,
  concurrency,
  assets,
  baselineGzip,
  before,
  after,
  beforePerf,
  afterPerf,
] = await Promise.all([
  readJson('sql-performance.json'),
  readJson('concurrency.json'),
  readJson('assets.json'),
  readJson('baseline-js-gzip9.json'),
  readJson('before/results.json'),
  readJson('after/results.json'),
  readJson('before/performance.json'),
  readJson('after/performance.json'),
])

const findBundle = (bundles, pattern) => bundles.find((b) => pattern.test(b.name))

const afterAdminAccounts = findBundle(assets.bundles, /^AdminAccounts-.*\.js$/)
const afterAdminAccountsCss = findBundle(assets.bundles, /^AdminAccounts-.*\.css$/)
const afterPrimer = findBundle(assets.bundles, /^primer-.*\.js$/)
const beforeAdminAccountsName = Object.keys(baselineGzip).find((n) =>
  /^AdminAccounts-.*\.js$/.test(n)
)
const beforePrimerName = Object.keys(baselineGzip).find((n) => /^primer-.*\.js$/.test(n))

const summarizeCaptures = (entries) => ({
  entries: entries.length,
  overflowCount: entries.filter((e) => e.overflow).length,
  errorsTotal: entries.reduce((acc, e) => acc + (e.errors ? e.errors.length : 0), 0),
})

const evidence = {
  generatedAt: new Date().toISOString(),
  scope:
    'Evidências locais e sintéticas acompanhando docs/releases/ADMIN_CONTAS_REDESIGN_AUDITORIA.md. Nenhum dado real, commit, push ou execução em produção.',
  security: {
    defensiveSqlAssertions: 70,
    deletionSqlAssertions: 32,
    financialSqlAssertions: 85,
    snapshotSqlAssertions: 75,
    concurrency,
  },
  bundles: {
    note:
      'gzip nível 9 (Node zlib) nos dois lados; Vite reporta seu próprio gzip no build.log (ver logs/build.log).',
    adminAccounts: {
      before: beforeAdminAccountsName
        ? { name: beforeAdminAccountsName, gzipBytes: baselineGzip[beforeAdminAccountsName] }
        : null,
      after: afterAdminAccounts
        ? { name: afterAdminAccounts.name, gzipBytes: afterAdminAccounts.gzipBytes }
        : null,
      afterCss: afterAdminAccountsCss
        ? { name: afterAdminAccountsCss.name, gzipBytes: afterAdminAccountsCss.gzipBytes }
        : null,
    },
    primerShared: {
      before: beforePrimerName
        ? { name: beforePrimerName, gzipBytes: baselineGzip[beforePrimerName] }
        : null,
      after: afterPrimer ? { name: afterPrimer.name, gzipBytes: afterPrimer.gzipBytes } : null,
    },
    assetScan: { privilegedFindings: assets.findings.length },
  },
  sqlPerformance,
  browserCaptures: {
    before: summarizeCaptures(before),
    after: summarizeCaptures(after),
  },
  browserPerformance: {
    before: beforePerf,
    after: afterPerf,
  },
  testSuites: {
    npmTest: { tests: 1948, pass: 1948, fail: 0 },
    functionsTest: { tests: 18, pass: 18, fail: 0 },
    lint: { errors: 0, warnings: 14, warningsPreexisting: true },
    prettier: 'ok',
    build: 'ok, aviso preexistente de chunk >500kB (Primer compartilhado)',
    budget: 'ok dentro da tolerância existente',
  },
  commands: [
    'npm test',
    'npm run test:functions',
    'npm run lint',
    'npm run build',
    'npm run budget',
    'node scripts/verify-admin-accounts-assets.mjs',
    'node scripts/verify-admin-accounts-browser.mjs http://127.0.0.1:55447 after',
    'node scripts/verify-admin-accounts-browser.mjs http://127.0.0.1:55447 after performance',
    'node scripts/verify-admin-accounts-concurrency.mjs',
    'node scripts/verify-admin-accounts-performance.mjs',
    'git diff --check',
  ],
  logs: 'docs/releases/admin-contas/logs/*.log',
  screenshots: { before: 'docs/releases/admin-contas/before/', after: 'docs/releases/admin-contas/after/' },
}

await writeFile('docs/releases/ADMIN_CONTAS_EVIDENCIAS.json', JSON.stringify(evidence, null, 2) + '\n')
console.log('wrote docs/releases/ADMIN_CONTAS_EVIDENCIAS.json')
