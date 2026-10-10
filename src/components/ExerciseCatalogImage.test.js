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
let imgSrcAfterErrors
let renderAfterErrors

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
        // Dispara onError \`times\` vezes seguidas (cadeia src -> fallbackSrc -> placeholder) e
        // devolve o <img> atual (null quando já esgotou e caiu no placeholder).
        export const imgSrcAfterErrors = (props, times) => {
          let component
          act(() => { component = TestRenderer.create(createElement(ExerciseCatalogImage, props)) })
          for (let i = 0; i < times; i += 1) {
            const img = component.root.findAllByType('img')[0]
            if (!img) break
            act(() => { img.props.onError() })
          }
          const remaining = component.root.findAllByType('img')
          return remaining.length ? remaining[0].props.src : null
        }
        export const renderAfterErrors = (props, times) => {
          let component
          act(() => { component = TestRenderer.create(createElement(ExerciseCatalogImage, props)) })
          for (let i = 0; i < times; i += 1) {
            const img = component.root.findAllByType('img')[0]
            if (!img) break
            act(() => { img.props.onError() })
          }
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
  ;({ render, renderAfterError, imgSrcAfterErrors, renderAfterErrors } = createRequire(import.meta.url)(outfile))
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

test('catalog image renders a harmless fallback without a URL (reason: none-published)', () => {
  const html = render({ src: null })
  assert.match(html, /data-image-fallback="true"/)
  assert.match(html, /data-fallback-reason="none-published"/)
  assert.match(html, /aria-hidden="true"/)
  assert.match(html, /Este exercício ainda não tem imagem publicada/)
  assert.doesNotMatch(html, /<img/)
})

test('image that failed to load defaults to a DIFFERENT reason (offline-unavailable), not "none-published"', () => {
  const fallback = renderAfterError({ src: '/0.webp' })
  assert.equal(fallback.props['data-fallback-reason'], 'offline-unavailable')
  assert.deepEqual(fallback.children, ['Imagem não disponível neste aparelho offline'])
})

test('explicit fallbackLabel (including an empty string, for blank grid cards) always wins over both defaults', () => {
  assert.equal(render({ src: null, fallbackLabel: '' }).includes('Este exercício'), false)
  const blankFallback = renderAfterError({ src: '/0.webp', fallbackLabel: '' })
  assert.equal(blankFallback.children, null, 'texto vazio -- sem nenhum dos dois textos padrão')
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

// fallbackSrc (thumbnail): start/end publicada mas indisponível neste aparelho tenta a miniatura
// antes de desistir -- nunca usada quando o src principal já carrega.
test('fallbackSrc is never used while the primary src is loading fine', () => {
  const html = render({ src: '/start.webp', fallbackSrc: '/thumb.webp' })
  assert.match(html, /start\.webp/)
  assert.doesNotMatch(html, /thumb\.webp/)
})

test('primary src fails: switches to fallbackSrc (thumbnail) instead of the placeholder', () => {
  const src = imgSrcAfterErrors({ src: '/start.webp', fallbackSrc: '/thumb.webp' }, 1)
  assert.equal(src, '/thumb.webp')
})

test('primary AND fallbackSrc both fail: falls back to the placeholder (offline-unavailable), never loops', () => {
  const tree = renderAfterErrors({ src: '/start.webp', fallbackSrc: '/thumb.webp', fallbackLabel: 'Imagem indisponível' }, 2)
  assert.equal(tree.props['data-image-fallback'], true)
  assert.equal(tree.props['data-fallback-reason'], 'offline-unavailable')
  assert.deepEqual(tree.children, ['Imagem indisponível'])
})

test('no primary src but a fallbackSrc exists: uses the fallback directly as the first attempt', () => {
  const html = render({ src: null, fallbackSrc: '/thumb.webp' })
  assert.match(html, /thumb\.webp/)
  assert.doesNotMatch(html, /data-image-fallback/)
})

test('fallbackSrc identical to src is ignored (never retried as if it were a different image)', () => {
  const tree = renderAfterErrors({ src: '/same.webp', fallbackSrc: '/same.webp' }, 1)
  assert.equal(tree.props['data-image-fallback'], true, 'uma única tentativa -- não finge que a mesma URL é um fallback')
})
