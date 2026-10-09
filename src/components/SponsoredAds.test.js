import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let render
let mountBanner

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sponsored-ads-ui-tests-'))
  const outfile = join(directory, 'sponsored-ads-ui.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { SponsoredAdBanner } from './SponsoredAdBanner.jsx'
        import { SponsoredAdCard } from './SponsoredAdCard.jsx'

        const textOf = (node) =>
          typeof node === 'string' ? node : (node.children || []).map(textOf).join('')

        // Monta o banner de verdade (efeitos incluídos) para exercitar o botão "próximo".
        export function mountBanner(ads) {
          globalThis.window = {
            matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
          }
          globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(
              React.createElement(MemoryRouter, null, React.createElement(SponsoredAdBanner, { ads }))
            )
          })
          const read = () => ({
            count: renderer.root.findAll((n) => n.props.className === 'sponsored-ad-banner-count').map((n) => textOf(n))[0],
            partner: textOf(renderer.root.findByProps({ className: 'sponsored-ad-banner-partner' })),
            label: renderer.root.findByType('button').props['aria-label'],
          })
          return {
            read,
            next: () => act(() => renderer.root.findByType('button').props.onClick()),
            unmount: () => act(() => renderer.unmount()),
          }
        }

        export function render(kind, props) {
          const Component = kind === 'banner' ? SponsoredAdBanner : SponsoredAdCard
          return renderToStaticMarkup(
            React.createElement(MemoryRouter, null, React.createElement(Component, props))
          )
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
  })
  ;({ render, mountBanner } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const ad = (extra = {}) => ({
  id: 'a1',
  partnerName: 'Marca X',
  title: 'Whey com 20% off',
  description: 'Condição válida para membros.',
  imageUrl: null,
  ctaLabel: 'Ver oferta',
  ctaType: 'external',
  ctaTarget: 'https://marca.example/oferta',
  displayMode: ['banner', 'feed'],
  ...extra,
})

test('banner sem campanha não renderiza nada (nenhum espaço vazio)', () => {
  assert.equal(render('banner', { ads: [] }), '')
})

test('banner: selo Patrocinado, marca, mensagem e CTA externo seguro', () => {
  const html = render('banner', { ads: [ad()] })
  assert.match(html, /Patrocinado/)
  assert.match(html, /Marca X/)
  assert.match(html, /Whey com 20% off/)
  assert.match(html, /href="https:\/\/marca\.example\/oferta"/)
  assert.match(html, /target="_blank"/)
  assert.match(html, /rel="noopener noreferrer sponsored"/)
  assert.match(html, /aria-label="Patrocinado: Marca X"/)
  assert.doesNotMatch(html, /<img/)
  // campanha única: nenhum controle de navegação
  assert.doesNotMatch(html, /sponsored-ad-banner-nav|sponsored-ad-banner-next|1\/1/)
})

test('banner: CTA interno é link do roteador; sem CTA não há link; rodízio mostra 1/2 e o botão próximo', () => {
  const internal = render('banner', { ads: [ad({ ctaType: 'internal', ctaTarget: '/planos' })] })
  assert.match(internal, /href="\/planos"/)
  assert.doesNotMatch(internal, /target="_blank"/)
  assert.doesNotMatch(
    render('banner', { ads: [ad({ ctaLabel: null, ctaType: null, ctaTarget: null })] }),
    /<a /
  )
  const multi = render('banner', { ads: [ad(), ad({ id: 'a2' })] })
  assert.match(multi, /1\/2/)
  assert.match(
    multi,
    /<button[^>]*sponsored-ad-banner-next[^>]*aria-label="Próximo patrocínio \(1 de 2\)"/
  )
  assert.doesNotMatch(multi, /sponsored-ad-banner-dot/)
})

test('card do feed: selo Patrocinado sempre presente, título, descrição e CTA', () => {
  const html = render('card', { ad: ad() })
  assert.match(html, /<article/)
  assert.match(html, /Patrocinado/)
  assert.match(html, /<h3[^>]*>Whey com 20% off<\/h3>/)
  assert.match(html, /Condição válida para membros\./)
  assert.match(html, /rel="noopener noreferrer sponsored"/)
})

test('card do feed: imagem com dimensões reservadas, lazy e sem referrer; sem imagem não há moldura', () => {
  const withImage = render('card', { ad: ad({ imageUrl: 'https://cdn.example/a.jpg' }) })
  assert.match(withImage, /<img[^>]*loading="lazy"/)
  assert.match(withImage, /width="640"/)
  assert.match(withImage, /height="360"/)
  assert.match(withImage, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i)
  assert.doesNotMatch(render('card', { ad: ad() }), /sponsored-ad-media/)
})

test('card do feed: texto muito longo continua dentro do card (sem HTML cru)', () => {
  const long = 'x'.repeat(500)
  const html = render('card', { ad: ad({ description: long, title: '<b>t</b>' }) })
  assert.match(html, /&lt;b&gt;t&lt;\/b&gt;/)
  assert.ok(html.includes(long))
})

test('banner: botão próximo avança, dá a volta e informa a posição; contador 1/2 -> 2/2 -> 1/2', () => {
  const view = mountBanner([
    ad({ partnerName: 'Marca A' }),
    ad({ id: 'a2', partnerName: 'Marca B' }),
  ])
  assert.deepEqual(view.read(), {
    count: '1/2',
    partner: 'Marca A',
    label: 'Próximo patrocínio (1 de 2)',
  })
  view.next()
  assert.deepEqual(view.read(), {
    count: '2/2',
    partner: 'Marca B',
    label: 'Próximo patrocínio (2 de 2)',
  })
  view.next()
  assert.equal(view.read().count, '1/2')
  view.unmount()
})
