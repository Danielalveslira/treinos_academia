// Run every pgTAP file against an already running, isolated local-stack.sh instance.
// Preserve cron.job definitions for assertions while the cron launcher is disabled.
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const db = process.env.HOMOLOG_SQL_DB === 'edb' ? 'edb' : 'hdb'
const expectedNetwork = db === 'edb' ? 'eisolated' : 'homolog-isolated'
const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', ...options })
const value = (query) => docker(['exec', db, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-tAc', query]).trim()

if (value('show cron.launch_active_jobs') !== 'off') {
  throw new Error('Cron launcher is active; refusing to run SQL tests')
}
const network = docker(['inspect', '-f', '{{.HostConfig.NetworkMode}}', db]).trim()
if (network !== expectedNetwork) throw new Error(`Unexpected Docker network: ${network}`)
const internal = docker(['network', 'inspect', '-f', '{{.Internal}}', network]).trim()
if (internal !== 'true') throw new Error('Docker network is not internal')

docker(['cp', 'supabase/tests/.', `${db}:/tmp/auth-sql-tests`])
const requested = process.argv.slice(2)
const files = requested.length
  ? requested.filter((name) => name.endsWith('_test.sql') && readdirSync('supabase/tests').includes(name))
  : readdirSync('supabase/tests').filter((name) => name.endsWith('_test.sql')).sort()
let passed = 0
const failed = []
for (const file of files) {
  let output = ''
  let exit = 0
  try {
    output = docker(['exec', db, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-f', `/tmp/auth-sql-tests/${file}`], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    exit = error.status ?? 1
    output = `${error.stdout || ''}\n${error.stderr || ''}`
  }
  const assertions = output.match(/^not ok\b.*$/gm) || []
  if (exit || assertions.length || !/All tests successful\.|^\s*finish\s*$/m.test(output)) {
    failed.push(file)
    console.error(`FAIL ${file} (exit ${exit})\n${assertions.join('\n') || output.slice(-1600)}`)
  } else {
    passed++
    console.log(`PASS ${file}`)
  }
}
console.log(`pgTAP: ${passed}/${files.length} files passed; cron jobs preserved, launcher off`)
if (failed.length) {
  console.error(`Failed files: ${failed.join(', ')}`)
  process.exitCode = 1
}
