import { readdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
const files = (await readdir('dist/assets')).filter((name) => /\.(js|css)$/.test(name))
const findings = [],
  bundles = []
for (const name of files) {
  const data = await readFile(`dist/assets/${name}`),
    source = data.toString('utf8')
  bundles.push({ name, bytes: data.length, gzipBytes: gzipSync(data, { level: 9 }).length })
  if (/sb_secret_[a-zA-Z0-9]+|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(source))
    findings.push({ name, kind: 'private key pattern' })
  for (const match of source.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      if (JSON.parse(Buffer.from(match[1], 'base64url')).role === 'service_role')
        findings.push({ name, kind: 'privileged JWT' })
    } catch {
      /* Not all similar strings are JWTs. */
    }
  }
}
assert.deepEqual(findings, [], 'privileged credential detected; details omitted')
await writeFile(
  'docs/releases/admin-contas/assets.json',
  JSON.stringify({ findings, bundles }, null, 2)
)
console.log(JSON.stringify({ scanned: files.length, privilegedFindings: findings.length }))
