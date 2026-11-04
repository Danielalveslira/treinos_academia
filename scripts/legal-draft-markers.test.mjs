import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('minuta geral não contém marcadores de pendência nas cláusulas', () => {
  const draft = readFileSync(
    new URL('../legal/drafts/general-2.0.0.documents.json', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(draft, /\[PENDENTE\b/i)
})
