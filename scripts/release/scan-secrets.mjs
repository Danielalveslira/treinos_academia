// High-signal credential scan; reports location/type only, never matched values.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export function inspectSecrets(text, { browser = false } = {}) {
  const findings = []
  const rules = [
    ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
    ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
    ['supabase_secret', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g],
    ['supabase_management_token', /\bsbp_[a-f0-9]{40,}\b/g],
    ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    [
      'database_password_url',
      /postgres(?:ql)?:\/\/[^\s:"'<>/]+:([^\s@"'<>]+)@([^\s/:"'<>]+)[^\s"'<>]*/g,
    ],
  ]
  for (const [kind, pattern] of rules) {
    for (const match of text.matchAll(pattern)) {
      // Existing local-only synthetic passwords and documented placeholders are not secrets.
      if (kind === 'database_password_url') {
        if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(match[1])) continue
        if (/^(?:YOUR_PASSWORD|\[YOUR-PASSWORD\])$/.test(match[1])) continue
        if (
          ['127.0.0.1', 'localhost'].includes(match[2]) &&
          /^(?:postgres|password|integrated-local-synthetic-password|local-aud-synthetic-password|local-finance-only)$/.test(
            match[1]
          )
        )
          continue
      }
      findings.push({ kind, line: text.slice(0, match.index).split('\n').length })
    }
  }
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString())
      if (payload.role === 'service_role')
        findings.push({
          kind: 'service_role_jwt',
          line: text.slice(0, match.index).split('\n').length,
        })
    } catch {
      /* Not a JWT payload. */
    }
  }
  if (browser) {
    for (const match of text.matchAll(
      /\b(?:SUPABASE_SERVICE_ROLE_KEY|INFINITEPAY_API_KEY|SUPABASE_ACCESS_TOKEN)\b/g
    )) {
      findings.push({
        kind: 'backend_secret_reference_in_browser',
        line: text.slice(0, match.index).split('\n').length,
      })
    }
  }
  return findings
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(resolve(dir, e.name)) : e.isFile() ? [resolve(dir, e.name)] : []
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const browser = process.argv.includes('--dist')
  if (process.argv.slice(2).some((x) => x !== '--dist')) throw Error('Only --dist is accepted')
  let paths
  try {
    paths = browser
      ? walk('dist')
      : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
          encoding: 'utf8',
        })
          .split('\0')
          .filter(Boolean)
  } catch {
    throw Error('Cannot enumerate files for credential scan')
  }
  const findings = []
  for (const file of [...new Set(paths)]) {
    if (/(^|\/)\.finance-local\//.test(relative(process.cwd(), resolve(file)))) {
      findings.push({ file, kind: 'private_runtime_artifact' })
      continue
    }
    // Never follow a symlink outside the reviewed tree.
    let stat
    try {
      stat = lstatSync(file)
    } catch (error) {
      if (error.code === 'ENOENT') continue // Tracked deletion in the reviewed working tree.
      throw error
    }
    if (stat.isSymbolicLink()) continue
    const bytes = readFileSync(file)
    if (bytes.includes(0)) continue
    for (const item of inspectSecrets(bytes.toString('utf8'), { browser }))
      findings.push({ file: relative(process.cwd(), resolve(file)), ...item })
  }
  console.log(
    JSON.stringify(
      { mode: browser ? 'browser-build' : 'working-tree', files: paths.length, findings },
      null,
      2
    )
  )
  process.exitCode = findings.length ? 1 : 0
}
