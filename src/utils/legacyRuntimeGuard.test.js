import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Guardas contra a volta de resíduos da arquitetura Firebase/Firestore. O banco é Supabase/Postgres:
// timestamptz chega como string ISO, nunca como Timestamp com .toDate() -- e foi exatamente isso que
// derrubou Support, AdminModeration e PublicProfile ("x.toDate is not a function"). A única parte do
// projeto autorizada a conhecer formatos legados de data é src/utils/date.js (toDate/toMillis).
const SRC = new URL('..', import.meta.url).pathname
const HELPER = join(SRC, 'utils/date.js')

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(js|jsx)$/.test(name) && !/\.test\.js$/.test(name) ? [path] : []
  })
}

// Remove comentários para que mencionar o padrão antigo numa explicação não conte como uso.
function code(path) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function offenders(pattern, { except = [] } = {}) {
  return sourceFiles(SRC)
    .filter((file) => !except.includes(file))
    .flatMap((file) => (pattern.test(code(file)) ? [relative(SRC, file)] : []))
}

test('no direct .toDate / .toMillis outside the compatibility helper (src/utils/date.js)', () => {
  assert.deepEqual(offenders(/\.toDate\b|\.toMillis\b/, { except: [HELPER] }), [])
})

test('no component or util re-implements its own toDate (use src/utils/date.js)', () => {
  assert.deepEqual(offenders(/function\s+toDate\s*\(|const\s+toDate\s*=/, { except: [HELPER] }), [])
  assert.deepEqual(
    offenders(/function\s+toMillis\s*\(|const\s+toMillis\s*=/, { except: [HELPER] }),
    []
  )
})

test('no Firestore Timestamp internals (_seconds/_nanoseconds/.nanoseconds) anywhere', () => {
  assert.deepEqual(offenders(/\._seconds\b|_nanoseconds\b|\.nanoseconds\b/), [])
})

test('no Firebase/Firestore imports or APIs in the frontend', () => {
  assert.deepEqual(
    offenders(
      /from\s+['"](?:@?firebase)|require\(['"]firebase|serverTimestamp\s*\(|onSnapshot\s*\(|getFirestore\s*\(|arrayUnion\s*\(|arrayRemove\s*\(|new\s+Timestamp\s*\(|Timestamp\.(?:now|fromDate|fromMillis)/
    ),
    []
  )
})

test('the guard itself catches the bug that crashed PublicProfile', () => {
  const bad = 'formatDateTime(result.statistics.updatedAt?.toDate())'
  assert.match(bad, /\.toDate\b/)
})
