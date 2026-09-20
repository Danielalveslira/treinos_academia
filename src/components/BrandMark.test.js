import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let renderStatic
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brand-mark-tests-'))
  const outfile = join(directory, 'brand-mark.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { BrandMark } from './BrandMark.jsx'
        export const renderStatic = (props) => renderToStaticMarkup(createElement(BrandMark, props))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
  })
  ;({ renderStatic } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('without a color prop, renders the two paths with no inline fill -- the existing bicolor CSS classes decide the color, unchanged', () => {
  const html = renderStatic({})
  assert.match(html, /class="brand-mark-arrow"/)
  assert.match(html, /class="brand-mark-letter"/)
  assert.doesNotMatch(html, /style="/)
})

test('with a color prop, both paths get an inline fill override to the same solid color', () => {
  const html = renderStatic({ color: 'var(--fitness-blue)' })
  const styleMatches = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1])
  assert.equal(styleMatches.length, 2, 'as duas partes (seta e letra) recebem o override')
  for (const style of styleMatches) {
    assert.match(style, /fill:var\(--fitness-blue\)/)
  }
})

test('size and className still work exactly as before, independent of color', () => {
  const html = renderStatic({ size: 14, className: 'wallet-badge-icon', color: 'var(--fitness-accent)' })
  assert.match(html, /width="14"/)
  assert.match(html, /height="14"/)
  assert.match(html, /class="brand-mark-svg wallet-badge-icon"/)
})
