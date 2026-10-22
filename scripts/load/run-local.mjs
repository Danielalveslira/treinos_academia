// Executa um nível do k6 contra a stack local e amostra recursos do Docker/PostgreSQL.
// Uso: node scripts/load/run-local.mjs 25 60s [sustained|spike|stress|soak]
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import os from 'node:os'

const vus = Number(process.argv[2] || 5)
const duration = process.argv[3] || '60s'
const profile = process.argv[4] || 'sustained'
if (!Number.isInteger(vus) || vus < 1 || vus > 1000 || !/^\d+[sm]$/.test(duration) || !['sustained', 'spike', 'stress', 'soak'].includes(profile)) throw new Error('Argumentos inválidos')
const fixture = JSON.parse(await readFile('/tmp/evolutus-load/fixtures.json', 'utf8'))
if (fixture.auth !== 'http://127.0.0.1:55432' || fixture.rest !== 'http://127.0.0.1:55431') throw new Error('Somente homologação local')
const name = `${profile}-${vus}-${duration}`
const k6Image = 'grafana/k6@sha256:e66db15b860113878fa74670e31f5e274830b7b6e42c8bff28b2f2d86a257603'
const fixtureDir = '/tmp/evolutus-load'
const dir = resolve('docs/performance/evidence')
await mkdir(dir, { recursive: true })
const sql = (query) => execFileSync('docker', ['exec', 'evolutus_homolog_db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-At', '-c', query], { encoding: 'utf8' }).trim()
if (sql("select current_setting('cron.launch_active_jobs')") !== 'off') throw new Error('cron local deve estar desativado antes da carga')
function database() {
  return JSON.parse(sql(`select json_build_object(
    'connections', (select count(*) from pg_stat_activity where datname='postgres'),
    'stats', (select row_to_json(s) from (select blks_hit,blks_read,xact_commit,xact_rollback from pg_stat_database where datname='postgres') s),
    'statements', (select coalesce(json_agg(x),'[]'::json) from (select queryid::text id,calls,total_exec_time,mean_exec_time,rows,
      left(regexp_replace(query,'[[:space:]]+',' ','g'),160) query from pg_stat_statements
      where query ~* 'workouts|status_publications|statuses|progress|professional|exercises|community|auth.users'
      order by total_exec_time desc limit 100) x)
  )::text;`))
}
function resource() {
  const raw = execFileSync('docker', ['stats', '--no-stream', '--format', '{{json .}}', 'evolutus_homolog_db', 'evolutus_homolog_auth', 'evolutus_homolog_rest', 'evolutus_homolog_storage', 'evolutus_k6_load'], { encoding: 'utf8' })
  return raw.trim().split('\n').filter(Boolean).map((line) => {
    const row = JSON.parse(line)
    return { name: row.Name, cpu: row.CPUPerc, mem: row.MemUsage, net: row.NetIO }
  })
}

const before = database()
const args = ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, '--name', 'evolutus_k6_load', '--network', 'host',
  '-v', `${resolve('scripts/load')}:/work:ro`, '-v', `${fixtureDir}:/fixture:ro`, '-v', `${dir}:/results`,
  '-e', `LOAD_VUS=${vus}`, '-e', `LOAD_DURATION=${duration}`, '-e', `LOAD_PROFILE=${profile}`,
  k6Image, 'run', '--summary-export', `/results/${name}.json`, '--quiet', '/work/evolutus.k6.js']
const started = new Date().toISOString()
const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', (chunk) => { output += chunk.toString() })
child.stderr.on('data', (chunk) => { output += chunk.toString() })
const samples = []
const sampler = setInterval(() => {
  try {
    const db = database()
    samples.push({ at: new Date().toISOString(), connections: db.connections, resources: resource(), hostLoad: os.loadavg()[0] })
  } catch (error) { samples.push({ at: new Date().toISOString(), sampleError: error.message }) }
}, 5000)
const exitCode = await new Promise((done) => child.on('exit', (code) => done(code)))
clearInterval(sampler)
const after = database()
const summary = JSON.parse(await readFile(`${dir}/${name}.json`, 'utf8'))
const result = { name, profile, vus, duration, started, finished: new Date().toISOString(), exitCode, before, after, samples, summary }
await writeFile(`${dir}/${name}-evidence.json`, JSON.stringify(result, null, 2))
const rps = summary.metrics.http_reqs?.rate
const p95 = summary.metrics.http_req_duration?.['p(95)']
const errors = summary.metrics.http_req_failed?.value
console.log(`${name} exit=${exitCode} rps=${rps?.toFixed(2)} p95=${p95?.toFixed(1)}ms errors=${(errors * 100)?.toFixed(2)}% samples=${samples.length}`)
if (exitCode !== 0) console.log(output.slice(-1800))
process.exitCode = exitCode || 0
