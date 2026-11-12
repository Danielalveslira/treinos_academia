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
        import AdvertisingCreativePreview from './advertising/AdvertisingCreativePreview.jsx'

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
            pool: renderer.root.findAll((n) => n.props.className === 'sponsored-ad-banner-pool').map((n) => textOf(n))[0],
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
          const Component = kind === 'banner' ? SponsoredAdBanner : kind === 'preview' ? AdvertisingCreativePreview : SponsoredAdCard
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
    plugins: [
      {
        name: 'stub-storefront-image',
        setup(bundle) {
          bundle.onResolve({ filter: /StorefrontImage$/ }, () => ({
            path: 'image',
            namespace: 'test-stub',
          }))
          bundle.onLoad({ filter: /.*/, namespace: 'test-stub' }, () => ({
            contents: 'export default function StorefrontImage() { return null }',
            loader: 'js',
          }))
        },
      },
    ],
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

test('banner do Progresso usa apenas um bloco compacto e não renderiza espaço vazio', () => {
  assert.equal(render('banner', { ads: [], placement: 'progress_banner' }), '')
  const html = render('banner', { ads: [ad()], placement: 'progress_banner' })
  assert.match(html, /sponsored-ad-banner--progress/)
  assert.equal((html.match(/<aside/g) || []).length, 1)
  assert.match(html, /Patrocinado/)
})

test('prévia mostra imagem e descrição somente no card do feed', () => {
  const props = {
    partnerName: 'Marca X',
    title: 'Oferta de teste',
    description: 'Descrição exclusiva do feed',
    mediaId: 'media-test',
  }
  for (const placement of ['home_banner', 'progress_banner', 'community_banner']) {
    const html = render('preview', { ...props, placements: [placement] })
    assert.match(html, /sponsored-ad-banner/)
    assert.doesNotMatch(
      html,
      /sponsored-ad-media|sponsored-ad-description|Descrição exclusiva do feed/
    )
    assert.doesNotMatch(html, /<a\b/)
  }
  const feed = render('preview', { ...props, placements: ['community_feed'] })
  assert.match(feed, /sponsored-ad-media/)
  assert.match(feed, /Descrição exclusiva do feed/)
  assert.doesNotMatch(feed, /<a\b/)
  const optional = render('preview', {
    ...props,
    description: '',
    mediaId: null,
    placements: ['community_feed'],
  })
  assert.doesNotMatch(optional, /sponsored-ad-media|sponsored-ad-description/)
  const institutional = render('preview', {
    ...props,
    mediaId: null,
    imageUrl: 'https://example.invalid/creative.png',
    ctaLabel: 'Participar',
    placements: ['home_banner', 'community_feed'],
  })
  assert.equal((institutional.match(/sponsored-ad-media/g) || []).length, 1)
  assert.match(institutional, /Participar/)
  assert.match(institutional, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i)
  assert.doesNotMatch(render('preview', { ...props, ctaLabel: '', placements: ['progress_banner'] }), /sponsored-ad-banner-cta/)
})

test('banner: amostra de 1 com eligibleTotal maior mostra "+N" (nunca uma posição falsa como "1/4")', () => {
  // select_advertising devolveu só 1 campanha nesta amostra (display_limit), mas 4 passaram a
  // elegibilidade naquele instante. O contador numérico é SEMPRE a posição dentro da amostra
  // local -- com só 1 item não há posição nenhuma a mostrar (nem "1/1", nem "1/4": esse último
  // sugeriria falsamente 4 posições navegáveis quando só existe 1 nesta amostra). O selo "+3"
  // avisa que há mais elegíveis sem fingir que dá pra avançar até eles sem nova consulta.
  const html = render('banner', { ads: [ad({ eligibleTotal: 4 })] })
  assert.doesNotMatch(html, /sponsored-ad-banner-count/)
  assert.match(html, /<span class="sponsored-ad-banner-pool"[^>]*>\+3<\/span>/)
  assert.doesNotMatch(html, /sponsored-ad-banner-next/)
})

test('banner: 5 elegíveis, amostra de 4 -- contador roda 1/4..4/4 (nunca "5/5" ou um "1/5" que nunca chega lá) e o selo "+1" se mantém', () => {
  // Reprodução exata do caso que a auditoria apontou: antes, o contador usava eligibleTotal
  // como denominador (mostrava "1/5"->"4/5" e voltava pro "1/5", nunca "5/5" -- parecia haver
  // uma 5ª posição alcançável que não existe nesta amostra). Agora o denominador é SEMPRE o
  // tamanho real da amostra local.
  const fiveEligible = [1, 2, 3, 4].map((i) => ad({ id: `a${i}`, eligibleTotal: 5 }))
  const view = mountBanner(fiveEligible)
  for (const expectedCount of ['1/4', '2/4', '3/4', '4/4', '1/4']) {
    const read = view.read()
    assert.equal(read.count, expectedCount)
    assert.match(read.pool, /^\+1$/)
    view.next()
  }
  view.unmount()
})

test('banner: eligibleTotal nunca encolhe abaixo do que foi de fato retornado', () => {
  // Defensivo: um valor inconsistente/desatualizado de eligibleTotal nunca esconde itens que
  // já estão na amostra local, nem produz um selo "+N" negativo.
  const html = render('banner', {
    ads: [ad({ eligibleTotal: 1 }), ad({ id: 'a2', eligibleTotal: 1 })],
  })
  assert.match(html, /1\/2/)
  assert.doesNotMatch(html, /sponsored-ad-banner-pool/)
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
    pool: undefined,
    partner: 'Marca A',
    label: 'Próximo patrocínio (1 de 2)',
  })
  view.next()
  assert.deepEqual(view.read(), {
    count: '2/2',
    pool: undefined,
    partner: 'Marca B',
    label: 'Próximo patrocínio (2 de 2)',
  })
  view.next()
  assert.equal(view.read().count, '1/2')
  view.unmount()
})
