import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Instrumentação dos cards/banners: monta os componentes REAIS (efeitos incluídos) com o coletor substituído por
// um registrador, uma vez com a flag de build LIGADA e outra DESLIGADA (o padrão em produção).
let directory
let on
let off

const STUB = `
  export function observeAd(element, meta) {
    globalThis.__adCalls.push({ type: 'observe', meta, element })
    return () => globalThis.__adCalls.push({ type: 'stop', meta })
  }
  export function trackAdClick(meta) {
    globalThis.__adCalls.push({ type: 'click', meta })
  }
`

async function bundle(outfile, flag) {
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { SponsoredAdBanner } from './SponsoredAdBanner.jsx'
        import { SponsoredAdCard } from './SponsoredAdCard.jsx'

        export function mount(kind, props, { reduced = false } = {}) {
          globalThis.__adCalls = []
          globalThis.window = {
            matchMedia: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
          }
          globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
          const Component = kind === 'banner' ? SponsoredAdBanner : SponsoredAdCard
          const element = (p) =>
            React.createElement(MemoryRouter, null, React.createElement(Component, p))
          let renderer
          act(() => {
            renderer = TestRenderer.create(element(props), {
              createNodeMock: () => ({ node: 'root' }),
            })
          })
          return {
            calls: () => globalThis.__adCalls,
            update: (p) => act(() => renderer.update(element(p))),
            unmount: () => act(() => renderer.unmount()),
            next: () => act(() => renderer.root.findByType('button').props.onClick()),
            cta: () =>
              renderer.root.findAll(
                (n) => typeof n.props.className === 'string' && /-cta$/.test(n.props.className) && typeof n.props.onClick === 'function'
              )[0],
          }
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
    define: flag
      ? {
          'import.meta.env.VITE_AD_METRICS_ENABLED': '"true"',
          'import.meta.env': '{"VITE_AD_METRICS_ENABLED":"true"}',
        }
      : {},
    plugins: [
      {
        name: 'stub-ad-metrics-runtime',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /adMetrics\/runtime$/ }, () => ({
            path: 'runtime-stub',
            namespace: 'stub',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: STUB,
            loader: 'js',
          }))
        },
      },
    ],
  })
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sponsored-ads-metrics-tests-'))
  await bundle(join(directory, 'on.cjs'), true)
  await bundle(join(directory, 'off.cjs'), false)
  const require = createRequire(import.meta.url)
  on = require(join(directory, 'on.cjs'))
  off = require(join(directory, 'off.cjs'))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const ad = (extra = {}) => ({
  id: 'a1',
  partnerName: 'Marca X',
  title: 'Oferta',
  description: '',
  imageUrl: null,
  ctaLabel: 'Ver',
  ctaType: 'external',
  ctaTarget: 'https://marca.example/oferta',
  displayMode: ['banner', 'feed'],
  ...extra,
})

// O coletor entra por import() dinâmico: espera a microtarefa do import resolver.
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))
const trusted = (extra = {}) => ({
  isTrusted: true,
  type: 'click',
  button: 0,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true
  },
  ...extra,
})

test('flag DESLIGADA: nada é observado nem enviado, e cliques são ignorados', async () => {
  const card = off.mount('card', { ad: ad(), communityId: 'c1' })
  card.cta().props.onClick(trusted())
  await tick()
  assert.deepEqual(card.calls(), [])
  card.unmount()
  const banner = off.mount('banner', { ads: [ad()], placement: 'home_banner' })
  banner.cta().props.onClick(trusted())
  await tick()
  assert.deepEqual(banner.calls(), [])
  banner.unmount()
})

test('flag LIGADA: card do feed observa o elemento com id/posição/comunidade e solta ao desmontar', async () => {
  const view = on.mount('card', { ad: ad(), communityId: 'c1' })
  await tick()
  assert.equal(view.calls().length, 1)
  assert.deepEqual(view.calls()[0].meta, {
    adId: 'a1',
    placement: 'community_feed',
    communityId: 'c1',
  })
  assert.ok(view.calls()[0].element, 'observa o elemento do cartão')
  view.unmount()
  assert.deepEqual(
    view.calls().map((c) => c.type),
    ['observe', 'stop']
  )
})

test('re-render com as mesmas props não observa de novo (sem duplicar)', async () => {
  const view = on.mount('card', { ad: ad(), communityId: 'c1' })
  await tick()
  for (let i = 0; i < 5; i += 1) view.update({ ad: ad(), communityId: 'c1' })
  await tick()
  assert.equal(view.calls().filter((c) => c.type === 'observe').length, 1)
  view.unmount()
})

test('banner da Home usa home_banner sem comunidade; o da comunidade usa community_banner + id', async () => {
  const home = on.mount('banner', { ads: [ad()], placement: 'home_banner' })
  await tick()
  assert.deepEqual(home.calls()[0].meta, {
    adId: 'a1',
    placement: 'home_banner',
    communityId: null,
  })
  home.unmount()
  const community = on.mount('banner', {
    ads: [ad()],
    placement: 'community_banner',
    communityId: 'c9',
  })
  await tick()
  assert.deepEqual(community.calls()[0].meta, {
    adId: 'a1',
    placement: 'community_banner',
    communityId: 'c9',
  })
  community.unmount()
})

test('banner sem campanhas não observa nada', async () => {
  const view = on.mount('banner', { ads: [], placement: 'home_banner' })
  await tick()
  assert.deepEqual(view.calls(), [])
  view.update({ ads: [ad()], placement: 'home_banner' })
  await tick()
  assert.equal(
    view.calls().filter((c) => c.type === 'observe').length,
    1,
    'campanha que chega depois passa a ser medida'
  )
  view.unmount()
})

for (const reduced of [true, false]) {
  test(`carrossel (prefers-reduced-motion=${reduced}): trocar de campanha solta a anterior e observa a nova`, async () => {
    const view = on.mount(
      'banner',
      { ads: [ad({ id: 'a1' }), ad({ id: 'a2' })], placement: 'home_banner' },
      { reduced }
    )
    await tick()
    view.next()
    await tick()
    assert.deepEqual(
      view.calls().map((c) => `${c.type}:${c.meta.adId}`),
      ['observe:a1', 'stop:a1', 'observe:a2'],
      'reduced motion não muda a regra: só a campanha visível é medida'
    )
    view.unmount()
  })
}

for (const [name, extra] of [
  ['CTA interno', { ctaType: 'internal', ctaTarget: '/planos' }],
  ['CTA externo', {}],
  ['CTA do WhatsApp', { ctaTarget: 'https://wa.me/5511999999999?text=oi' }],
]) {
  for (const kind of ['card', 'banner']) {
    test(`${kind} / ${name}: clique humano registra sem bloquear a navegação`, async () => {
      const props =
        kind === 'card'
          ? { ad: ad(extra), communityId: 'c1' }
          : { ads: [ad(extra)], placement: 'community_banner', communityId: 'c1' }
      const view = on.mount(kind, props)
      await tick()
      const event = trusted()
      const result = view.cta().props.onClick(event)
      assert.equal(
        result,
        undefined,
        'handler síncrono, não devolve promessa que a navegação tenha de esperar'
      )
      assert.equal(event.defaultPrevented, false, 'não cancela a navegação')
      await tick()
      const click = view.calls().find((c) => c.type === 'click')
      assert.deepEqual(click.meta, {
        adId: 'a1',
        placement: kind === 'card' ? 'community_feed' : 'community_banner',
        communityId: 'c1',
      })
      view.unmount()
    })
  }
}

test('clique sintético (script) não conta; botão do meio conta; botão direito não', async () => {
  const view = on.mount('card', { ad: ad(), communityId: 'c1' })
  await tick()
  const cta = view.cta()
  cta.props.onClick(trusted({ isTrusted: false }))
  cta.props.onAuxClick?.(trusted({ type: 'auxclick', button: 2 }))
  await tick()
  assert.equal(view.calls().filter((c) => c.type === 'click').length, 0)
  cta.props.onAuxClick?.(trusted({ type: 'auxclick', button: 1 }))
  await tick()
  assert.equal(view.calls().filter((c) => c.type === 'click').length, 1)
  view.unmount()
})
