import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadProductionReleaseEnv, validateOfflineReleaseConfig } from './check-offline-release-config.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const MAX_BUFFER = 32 * 1024 * 1024
const container = process.env.PG_TEST_CONTAINER
const dbUser = process.env.PG_TEST_USER || 'postgres'
const dbName = process.env.PG_TEST_DATABASE || 'postgres'

function run(label, command, args, { input } = {}) {
  console.log(`\n→ ${label}`)
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    input,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: 10 * 60_000,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (result.error || result.status !== 0) {
    console.error(output.split('\n').slice(-80).join('\n'))
    throw new Error(`${label} falhou (${result.error?.message || `exit ${result.status}`})`)
  }
  const summary = output.split('\n').filter((line) =>
    /^\s*(?:ℹ|#)\s*(?:tests|pass|fail|skipped|suites)\s+\d+/.test(line) ||
    /(?:Budget OK|problems \(|built in|SECURITY_PREFLIGHT_OK)/.test(line)
  )
  if (summary.length) console.log(summary.join('\n'))
  else console.log('OK')
  return output
}

function checkSqlEnvironment() {
  if (!container) throw new Error(
    'pgTAP obrigatório: defina PG_TEST_CONTAINER com um PostgreSQL local migrado e em execução. Nenhum teste SQL foi executado.'
  )
  const output = run('PostgreSQL local', 'docker', [
    'inspect', '-f', '{{.State.Running}}', container,
  ])
  if (output.trim() !== 'true') throw new Error(`PG_TEST_CONTAINER=${container} não está em execução`)
}

function runSqlTests() {
  // Preserve relative \ir helper paths, including on containers without a workspace mount.
  run('Preparar diretório SQL descartável', 'docker', [
    'exec', container, 'mkdir', '-p', '/tmp/evolutus-release-tests',
  ])
  run('Copiar suítes SQL para o banco descartável', 'docker', [
    'cp', `${join(ROOT, 'supabase/tests')}/.`, `${container}:/tmp/evolutus-release-tests`,
  ])
  const files = readdirSync(join(ROOT, 'supabase/tests'))
    .filter((name) => name.endsWith('_test.sql'))
    .sort()
  if (files.length < 32) throw new Error(`pgTAP incompleto: encontrei só ${files.length} arquivos SQL`)
  let assertions = 0
  let passed = 0
  let skipped = 0
  for (const file of files) {
    const output = run(`pgTAP ${file}`, 'docker', [
      'exec', '-i', '-w', '/tmp/evolutus-release-tests', container,
      'psql', '-X', '-U', dbUser, '-d', dbName,
      '-v', 'ON_ERROR_STOP=1', '-P', 'tuples_only=on', '-f', file,
    ])
    const plan = [...output.matchAll(/^\s*1\.\.(\d+)\s*$/gm)]
    const ok = [...output.matchAll(/^\s*ok\s+\d+\b.*$/gm)]
    const notOk = [...output.matchAll(/^\s*not ok\s+\d+\b.*$/gm)]
    const skips = [...output.matchAll(/#\s*SKIP\b/gi)]
    if (plan.length !== 1 || Number(plan[0][1]) !== ok.length + notOk.length || notOk.length || skips.length)
      throw new Error(`pgTAP ${file}: plano/resultado divergente (ok=${ok.length}, falhas=${notOk.length}, skips=${skips.length})`)
    assertions += Number(plan[0][1])
    passed += ok.length
    skipped += skips.length
  }
  if (assertions < 1456) throw new Error(`pgTAP perdeu cobertura: ${assertions} < 1456 asserts`)
  console.log(`pgTAP: ${files.length} arquivos; ${assertions} asserts; ${passed} aprovados; ${skipped} skips; 0 falhas`)
  const security = run('Security preflight SQL', 'docker', [
    'exec', '-i', container, 'psql', '-X', '-U', dbUser, '-d', dbName,
    '-v', 'ON_ERROR_STOP=1', '-P', 'tuples_only=on',
  ], { input: readFileSync(join(ROOT, 'scripts/offline-security-preflight.sql'), 'utf8') })
  if (!security.includes('SECURITY_PREFLIGHT_OK')) throw new Error('Security preflight SQL não confirmou sucesso')
}

function countNodeCases(label, files) {
  let cases = 0
  let passed = 0
  let skipped = 0
  for (const file of files) {
    const output = run(`${label} casos: ${file}`, 'node', [file])
    const number = (name) => Number(output.match(new RegExp(`(?:ℹ|#)\\s*${name}\\s+(\\d+)`))?.[1] ?? -1)
    const found = number('tests')
    const ok = number('pass')
    const skip = number('skipped')
    const failed = number('fail')
    if (found < 0 || ok < 0 || skip < 0 || failed !== 0 || ok + skip !== found || skip > 0)
      throw new Error(`${label} ${file}: contagem ausente, skip ou falha`)
    cases += found
    passed += ok
    skipped += skip
  }
  console.log(`${label}: ${files.length} arquivos; ${cases} casos; ${passed} aprovados; ${skipped} skips`)
}

function functionTestFiles() {
  const root = join(ROOT, 'supabase/functions')
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readdirSync(join(root, entry.name))
      .filter((name) => name.endsWith('.test.js'))
      .map((name) => `supabase/functions/${entry.name}/${name}`))
    .sort()
}

try {
  const configErrors = validateOfflineReleaseConfig(loadProductionReleaseEnv(ROOT))
  if (configErrors.length) throw new Error(`Configuração de produção insegura:\n${configErrors.join('\n')}`)
  console.log('Configuração: rollout operacional no Supabase; build sem percentuais VITE obsoletos.')
  checkSqlEnvironment() // falha antes da suíte longa se o gate obrigatório estiver ausente
  run('lint', 'npm', ['run', 'lint'])
  run('npm test', 'npm', ['test'])
  run('test:functions', 'npm', ['run', 'test:functions'])
  countNodeCases('test:functions', functionTestFiles())
  run('test:backfill', 'npm', ['run', 'test:backfill'])
  countNodeCases('test:backfill', readdirSync(join(ROOT, 'scripts'))
    .filter((name) => name.endsWith('.test.mjs')).map((name) => `scripts/${name}`).sort())
  runSqlTests()
  run('build', 'npm', ['run', 'build'])
  run('bundle budget', 'npm', ['run', 'budget'])
  run('git diff --check', 'git', ['diff', '--check'])
  console.log('\nRELEASE_OFFLINE_CHECK_OK')
} catch (error) {
  console.error(`\nRELEASE_OFFLINE_CHECK_FAILED: ${error.message}`)
  process.exitCode = 1
}
