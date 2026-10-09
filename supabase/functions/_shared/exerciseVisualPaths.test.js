import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: [new URL('./exerciseVisualPaths.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
})
const { draftPath, publishedPath, FILE_NAMES } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
)

test('draft: {catalog}/{set}/{arquivo}; publicado: {catalog}/v{versão}/{arquivo}', () => {
  assert.equal(draftPath('c1', 's1', 'start'), 'c1/s1/start.webp')
  assert.equal(draftPath('c1', 's1', 'thumbnail'), 'c1/s1/thumb.webp')
  assert.equal(publishedPath('c1', 3, 'end'), 'c1/v3/end.webp')
})

test('papéis fora do MVP e versões inválidas não geram path', () => {
  assert.equal(draftPath('c1', 's1', 'animation'), null)
  assert.equal(publishedPath('c1', 0, 'start'), null)
  assert.equal(publishedPath('c1', 1.5, 'start'), null)
  assert.equal(publishedPath('c1', 1, '../x'), null)
  assert.deepEqual(Object.keys(FILE_NAMES), ['start', 'end', 'thumbnail'])
})
