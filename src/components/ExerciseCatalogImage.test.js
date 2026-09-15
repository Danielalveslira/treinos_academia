import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let render
let renderAfterError

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'catalog-image-component-'))
  const outfile = join(directory, 'component.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ExerciseCatalogImage } from './ExerciseCatalogImage.jsx'
        export const render = (props) => renderToStaticMarkup(createElement(ExerciseCatalogImage, props))
        export const renderAfterError = (props) => {
          let component
          act(() => { component = TestRenderer.create(createElement(ExerciseCatalogImage, props)) })
          act(() => { component.root.findByType('img').props.onError() })
          return component.toJSON()
        }
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
  ;({ render, renderAfterError } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('catalog image is lazy, async-decoded and supports decorative thumbnails', () => {
  const html = render({ src: 'https://cdn.test/thumb.webp', alt: '' })
  assert.match(html, /loading="lazy"/)
  assert.match(html, /decoding="async"/)
  assert.match(html, /alt=""/)
})

test('catalog image renders a harmless fallback without a URL', () => {
  const html = render({ src: null })
  assert.match(html, /data-image-fallback="true"/)
  assert.match(html, /aria-hidden="true"/)
  assert.match(html, /Sem imagem/)
  assert.doesNotMatch(html, /<img/)
})

test('catalog thumbnail may disappear silently when its URL is unavailable', () => {
  assert.equal(render({ src: null, hideOnError: true }), '')
  assert.equal(renderAfterError({ src: '/thumb.webp', hideOnError: true }), null)
})

test('catalog image failure replaces only that image with its fallback', () => {
  const fallback = renderAfterError({ src: '/0.webp', fallbackLabel: 'Imagem indisponível' })
  assert.equal(fallback.props['data-image-fallback'], true)
  assert.deepEqual(fallback.children, ['Imagem indisponível'])
})
