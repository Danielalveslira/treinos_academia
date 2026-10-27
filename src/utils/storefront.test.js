import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('editorial and publication states stay independent; blocked and stale failures are actionable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'storefront-state-'))
  try {
    await build({
      entryPoints: [new URL('./storefront.js', import.meta.url).pathname],
      outfile: join(dir, 'utils.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
    })
    const { storefrontError, editorialLabels, publicationLabels } = await import(
      join(dir, 'utils.mjs')
    )
    assert.equal(editorialLabels.approved, 'Aprovada')
    assert.equal(publicationLabels.expired, 'Arquivada por expiração')
    assert.match(storefrontError({ message: 'EDITORIAL_REVISION_CONFLICT' }), /Atualize/)
    assert.match(storefrontError({ message: 'STOREFRONT_SUSPENDED' }), /moderação/)
    assert.match(storefrontError({ message: 'STOREFRONT_INCOMPLETE' }), /imagens/)
    assert.match(storefrontError({ message: 'Saldo de EvoCash insuficiente.' }), /insuficiente/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
