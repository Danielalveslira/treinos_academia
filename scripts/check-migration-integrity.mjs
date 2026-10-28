import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
export function checkMigrationIntegrity(files, baseline) {
  const versions = new Set()
  for (const [name, source] of Object.entries(files)) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name) || !source.trim())
      throw Error('INVALID_MIGRATION: ' + name)
    const version = name.slice(0, 14)
    if (versions.has(version)) throw Error('DUPLICATE_MIGRATION_VERSION: ' + version)
    versions.add(version)
  }
  for (const [name, hash] of Object.entries(baseline)) {
    if (!Object.hasOwn(files, name)) throw Error('HISTORICAL_MIGRATION_REMOVED: ' + name)
    if (createHash('sha256').update(files[name]).digest('hex') !== hash)
      throw Error('HISTORICAL_MIGRATION_CHANGED: ' + name)
  }
  const lastBaseline = Object.keys(baseline).sort().at(-1)?.slice(0, 14)
  for (const name of Object.keys(files))
    if (!Object.hasOwn(baseline, name) && name.slice(0, 14) <= lastBaseline)
      throw Error('BACKDATED_MIGRATION: ' + name)
  return { passed: true, migrations: versions.size, historical: Object.keys(baseline).length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = 'supabase/migrations'
  const files = Object.fromEntries(
    readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => [name, readFileSync(directory + '/' + name, 'utf8')])
  )
  const baseline = JSON.parse(
    readFileSync('docs/finance-restructure/consolidation/MIGRATIONS_BASELINE.json')
  ).sha256
  console.log(JSON.stringify(checkMigrationIntegrity(files, baseline)))
}
