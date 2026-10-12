// Reaplica o pacote somente no banco local, enquanto clientes legados publicam por HTTP.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { startAudGateway } from './homolog/aud-local-gateway.mjs'
const f = JSON.parse(readFileSync('/tmp/aud-homolog-sessions.json', 'utf8'))
execFileSync('node', ['scripts/build-aud-migration-batch.mjs'], { stdio: 'pipe' })
const gateway = await startAudGateway()
try {
  let source = readFileSync('/tmp/evolutus-aud-rollout.sql', 'utf8')
  // Amplia deliberadamente a fase estrita dentro da transação para revelar qualquer janela.
  source = source.replace(
    '-- SOURCE 20261026000003',
    "select 'AUD_STRICT_PHASE'; select pg_sleep(1);\n-- SOURCE 20261026000003"
  )
  const proc = spawn(
    'docker',
    [
      'exec',
      '-i',
      'evolutus_homolog_db',
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
  let log = '',
    failure = ''
  const strict = new Promise((resolve, reject) => {
    proc.stdout.on('data', (chunk) => {
      log += chunk
      if (log.includes('AUD_STRICT_PHASE')) resolve()
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (!log.includes('AUD_STRICT_PHASE')) reject(Error(`fase estrita não alcançada (${code})`))
    })
  })
  proc.stderr.on('data', (chunk) => {
    failure += chunk
  })
  const complete = new Promise((resolve, reject) =>
    proc.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(Error(`pacote local falhou (${code}): ${failure.slice(0, 250)}`))
    )
  )
  proc.stdin.end(source)
  await strict
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      fetch(`${f.API}/rest/v1/statuses`, {
        method: 'POST',
        headers: {
          apikey: f.anon,
          Authorization: `Bearer ${f.users[0].session.access_token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          community_id: f.community,
          author_id: f.users[0].id,
          author_username: 'dica falsa',
          author_is_superadmin: true,
          type: 'text',
          text: `rollout concorrente ${i}`,
        }),
      }).then(async (r) => ({ status: r.status, body: await r.json() }))
    )
  )
  await complete
  assert.ok(
    responses.every((r) => r.status === 201),
    'todas as chamadas devem concluir sem erro de privilégio'
  )
  assert.ok(
    responses.every(
      (r) =>
        r.body[0].author_username === 'aud_http_0' &&
        !r.body[0].author_is_superadmin &&
        !r.body[0].promoted
    ),
    'autoria e metadados permanecem do servidor'
  )
  console.log(
    'PASS pacote transacional: 20/20 INSERTs legados durante fase estrita; autoria corrigida, sem promoção forjada.'
  )
  console.log('Histórico Supabase não é testado aqui; verificar separadamente pela CLI real.')
} finally {
  await new Promise((r) => gateway.close(r))
}
