// Run from the trusted base revision, never from a PR checkout. Unknown paths run all jobs.
import { execFileSync } from 'node:child_process'

// Each path contributes an independent set of required browser suites (never a single
// "highest priority" mode) so a PR touching both catalog and sheets runs the union of both,
// not whichever profile happened to sort last.
const full = { run_js: true, run_sql: true, run_finance: true, browser: { base: true, catalog: true, full: true } }
const docs = { run_js: false, run_sql: false, run_finance: false, browser: {} }
const css = { run_js: true, run_sql: false, run_finance: false, browser: { base: true, catalog: true, full: true } }
const catalog = { run_js: true, run_sql: false, run_finance: false, browser: { base: true, catalog: true, full: false } }
const sheets = { run_js: true, run_sql: true, run_finance: false, browser: { base: true, catalog: false, full: false } }

export function parseNameStatus(buffer) {
  const parts = buffer.toString('utf8').split('\0')
  if (parts.at(-1) !== '') throw new Error('INVALID_DIFF_ENCODING')
  parts.pop()
  const changes = []
  for (let i = 0; i < parts.length;) {
    const status = parts[i++]
    if (!/^(A|M|D|R[0-9]{1,3}|C[0-9]{1,3})$/.test(status)) throw new Error('INVALID_DIFF_STATUS')
    const path = parts[i++]
    if (!path || path.startsWith('/') || path.includes('..')) throw new Error('INVALID_DIFF_PATH')
    const paths = [path]
    if (status.startsWith('R') || status.startsWith('C')) {
      const target = parts[i++]
      if (!target || target.startsWith('/') || target.includes('..')) throw new Error('INVALID_DIFF_PATH')
      paths.push(target)
    }
    changes.push({ status, paths })
  }
  if (!changes.length) throw new Error('EMPTY_DIFF')
  return changes
}

export function classifyPath(path) {
  if (/^\.github\/|^scripts\/ci\/|^supabase\/migrations\/|^supabase\/functions\/|^(package|package-lock)\.json$/.test(path)) return full
  if (/\.(md|txt)$/.test(path) && (path.startsWith('docs/') || path === 'README.md')) return docs
  if (/^docs\/[^/]+\/.*\.json$/.test(path)) return docs
  if (/^src\/features\/workoutSheets\/.*\.css$/.test(path) || path === 'src/pages/Exercises.css') return css
  if (/^src\/features\/workoutSheets\//.test(path) || /^scripts\/workout-sheets-/.test(path)) return sheets
  if (/^src\/utils\/exerciseCatalog(\.test)?\.js$/.test(path) ||
      /^src\/services\/(exerciseCatalogService|exercisesService)(\.test)?\.js$/.test(path) ||
      /^src\/pages\/Exercises\.jsx$/.test(path) ||
      /^src\/components\/ExerciseCatalog\.jsx$/.test(path) ||
      /^scripts\/phase3-exercises-browser-smoke\.mjs$/.test(path)) return catalog
  return full
}

export function classify(changes, { draft = false } = {}) {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('EMPTY_DIFF')
  const profiles = changes.flatMap((change) => change.paths.map(classifyPath))
  const result = {
    run_js: profiles.some((p) => p.run_js),
    run_sql: profiles.some((p) => p.run_sql),
    run_finance: profiles.some((p) => p.run_finance),
    browser_base: profiles.some((p) => p.browser.base),
    browser_catalog: profiles.some((p) => p.browser.catalog),
    browser_full: profiles.some((p) => p.browser.full),
    draft: Boolean(draft),
  }
  return result
}

if (process.argv[1]?.endsWith('/plan.mjs') && process.argv.includes('--base')) {
  const value = (key) => process.argv[process.argv.indexOf(key) + 1]
  const base = value('--base'), head = value('--head'), draft = value('--draft') === 'true'
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) throw new Error('INVALID_COMMIT')
  const diff = execFileSync('git', ['diff', '--name-status', '-z', '--find-renames', `${base}...${head}`])
  process.stdout.write(JSON.stringify({ ...classify(parseNameStatus(diff), { draft }), base_sha: base, head_sha: head }))
}
