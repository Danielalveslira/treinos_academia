import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectSecrets } from './scan-secrets.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('detects privileged credentials without returning their values', () => {
  const credential = 'sb_' + 'secret_' + 'a'.repeat(30)
  const result = inspectSecrets('const key="' + credential + '"')
  assert.equal(result[0].kind, 'supabase_secret')
  assert.ok(!JSON.stringify(result).includes(credential))
  assert.equal(inspectSecrets('gh' + 'p_' + 'b'.repeat(40))[0].kind, 'github_token')
})
test('distinguishes service role JWT from public anon JWT', () => {
  const jwt = (role) =>
    'eyJhbGciOiJIUzI1NiJ9.' +
    Buffer.from(JSON.stringify({ role })).toString('base64url') +
    '.signature'
  assert.equal(inspectSecrets(jwt('service_role'))[0].kind, 'service_role_jwt')
  assert.deepEqual(inspectSecrets(jwt('anon')), [])
})
test('checks browser references and literal private keys', () => {
  assert.equal(
    inspectSecrets('SUPABASE_' + 'SERVICE_ROLE_KEY', { browser: true })[0].kind,
    'backend_secret_reference_in_browser'
  )
  assert.equal(inspectSecrets('-----BEGIN ' + 'PRIVATE KEY-----')[0].kind, 'private_key')
})
test('allows synthetic local password but rejects embedded production credentials', () => {
  assert.deepEqual(
    inspectSecrets(
      'postgresql://postgres:integrated-local-synthetic-password@127.0.0.1:5432/postgres'
    ),
    []
  )
  assert.equal(
    inspectSecrets('postgresql://postgres:' + 'postgres' + '@db.example.org/postgres')[0].kind,
    'database_password_url'
  )
  assert.equal(
    inspectSecrets(
      'postgresql://postgres:' + 'actual-unexpected-password' + '@db.example.org/postgres'
    )[0].kind,
    'database_password_url'
  )
})

test('CLI rejects tracked private runtime artifacts even when binary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evolutus-scan-'))
  try {
    execFileSync('git', ['init', '-q', dir])
    mkdirSync(join(dir, '.finance-local'))
    writeFileSync(join(dir, '.finance-local', 'backup.dump'), Buffer.from([0, 1, 2]))
    execFileSync('git', ['-C', dir, 'add', '.finance-local/backup.dump'])
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./scan-secrets.mjs', import.meta.url))],
      { cwd: dir, encoding: 'utf8' }
    )
    assert.equal(r.status, 1)
    assert.equal(JSON.parse(r.stdout).findings[0].kind, 'private_runtime_artifact')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI scans the working tree when a tracked file has been deleted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evolutus-scan-deletion-'))
  try {
    execFileSync('git', ['init', '-q', dir])
    const file = join(dir, 'removed.txt')
    writeFileSync(file, 'ordinary text')
    execFileSync('git', ['-C', dir, 'add', 'removed.txt'])
    rmSync(file)
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./scan-secrets.mjs', import.meta.url))],
      { cwd: dir, encoding: 'utf8' }
    )
    assert.equal(r.status, 0)
    assert.deepEqual(JSON.parse(r.stdout).findings, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('browser scan distinguishes private output from an ignored ancestor checkout', () => {
  const parent = mkdtempSync(join(tmpdir(), 'evolutus-scan-ancestor-'))
  const dir = join(parent, '.finance-local', 'checkout')
  const cli = fileURLToPath(new URL('./scan-secrets.mjs', import.meta.url))
  try {
    mkdirSync(join(dir, 'dist'), { recursive: true })
    writeFileSync(join(dir, 'dist', 'app.js'), 'ordinary application code')
    let result = spawnSync(process.execPath, [cli, '--dist'], { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.deepEqual(JSON.parse(result.stdout).findings, [])
    mkdirSync(join(dir, 'dist', '.finance-local'))
    writeFileSync(join(dir, 'dist', '.finance-local', 'private.dump'), Buffer.from([0, 1]))
    result = spawnSync(process.execPath, [cli, '--dist'], { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stdout).findings[0].kind, 'private_runtime_artifact')
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})
