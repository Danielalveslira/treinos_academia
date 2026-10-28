import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { fetchProductCatalog } from './publicProductCatalogService.js'
const original = globalThis.document
after(() => {
  if (original === undefined) delete globalThis.document
  else globalThis.document = original
})
test('approved HTTP payload is consumed once and charged navigation age before expiration', async () => {
  let removed = false
  globalThis.document = {
    getElementById: () =>
      removed
        ? null
        : {
            textContent: JSON.stringify({
              groups: [{ key: 'approved' }],
              serverTime: '2026-10-27T10:00:00Z',
              validUntil: '2026-10-27T10:00:10Z',
            }),
            remove() {
              removed = true
            },
          },
  }
  const result = await fetchProductCatalog({ mode: 'groups' })
  assert.equal(removed, true)
  assert.equal(result.groups[0].key, 'approved')
  assert.ok(result.initialAgeMs >= 0)
  await assert.rejects(fetchProductCatalog({ mode: 'groups' }), /UNCONFIGURED/)
})
test('filtered navigation cannot reuse unfiltered HTML data', async () => {
  let removed = false
  globalThis.document = {
    getElementById: () => ({
      textContent: '{}',
      remove() {
        removed = true
      },
    }),
  }
  await assert.rejects(fetchProductCatalog({ mode: 'groups', brand: 'other' }), /UNCONFIGURED/)
  assert.equal(removed, true)
})
