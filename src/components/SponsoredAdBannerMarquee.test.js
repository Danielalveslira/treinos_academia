import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { marqueeTiming } from '../utils/bannerMarquee.js'

let directory
let mount

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'banner-marquee-tests-'))
  const outfile = join(directory, 'banner-marquee.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { SponsoredAdBanner } from './SponsoredAdBanner.jsx'

        const textOf = (node) =>
          typeof node === 'string' ? node : (node.children || []).map(textOf).join('')

        // Navegador falso: largura do texto/linha controláveis, Element.animate com relógio próprio e contadores
        // para provar "sem observador/animação sobrando".
        export function mount(ads, { textWidth, lineWidth = 200, reduced = false, animate = true } = {}) {
          const stats = { observers: 0, disconnected: 0, animations: [], listeners: 0 }
          const media = { matches: reduced }
          const docHandlers = new Set()
          let resize = null
          const line = { clientWidth: lineWidth }
          const text = { offsetWidth: textWidth }
          const animations = stats.animations
          text.animate = (keyframes, options) => {
            const animation = {
              keyframes, options, playState: 'running', currentTime: 0, pauses: 0, plays: 0, cancelled: false,
              pause() { this.playState = 'paused'; this.pauses += 1 },
              play() { this.playState = 'running'; this.plays += 1 },
              cancel() { this.playState = 'idle'; this.cancelled = true },
            }
            animations.push(animation)
            return animation
          }
          globalThis.Element = animate ? { prototype: { animate() {} } } : undefined
          globalThis.window = {
            matchMedia: () => ({
              get matches() { return media.matches },
              addEventListener() { stats.listeners += 1 },
              removeEventListener() { stats.listeners -= 1 },
            }),
          }
          globalThis.document = {
            hidden: false,
            addEventListener: (_, h) => { stats.listeners += 1; docHandlers.add(h) },
            removeEventListener: (_, h) => { stats.listeners -= 1; docHandlers.delete(h) },
          }
          globalThis.ResizeObserver = class {
            constructor(cb) { stats.observers += 1; resize = cb }
            observe() {}
            disconnect() { stats.observers -= 1; stats.disconnected += 1 }
          }
          let renderer
          act(() => {
            renderer = TestRenderer.create(
              React.createElement(MemoryRouter, null, React.createElement(SponsoredAdBanner, { ads })),
              { createNodeMock: (el) => (el.props.className === 'sponsored-ad-banner-text' ? text : el.props.className?.startsWith?.('sponsored-ad-banner-line') ? line : {}) }
            )
          })
          const one = (cls) => renderer.root.findAll((n) => n.props.className === cls)[0]
          const aside = () => renderer.root.findByType('aside')
          const lineNode = () => renderer.root.findAll((n) => n.props.className?.startsWith?.('sponsored-ad-banner-line'))[0]
          return {
            stats,
            lineProps: () => lineNode().props,
            count: () => { const n = one('sponsored-ad-banner-count'); return n ? textOf(n) : null },
            partner: () => textOf(one('sponsored-ad-banner-partner')),
            text: () => textOf(one('sponsored-ad-banner-text')),
            // avança o relógio simulado e o tempo das animações em execução
            advance: (ms, tickFn) => act(() => {
              for (const a of animations) if (a.playState === 'running') a.currentTime += ms
              tickFn(ms)
            }),
            touch: () => act(() => aside().props.onTouchStart()),
            release: () => act(() => aside().props.onTouchEnd()),
            setHidden: (v) => { globalThis.document.hidden = v; act(() => docHandlers.forEach((h) => h())) },
            resizeTo: (w) => { line.clientWidth = w; act(() => resize()) },
            unmount: () => act(() => renderer.unmount()),
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
  })
  ;({ mount } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const ad = (id, extra = {}) => ({
  id,
  partnerName: `Marca ${id}`,
  title: `Oferta ${id}`,
  description: '',
  imageUrl: null,
  ctaLabel: 'Ver',
  ctaType: 'external',
  ctaTarget: 'https://marca.example',
  displayMode: ['banner'],
  ...extra,
})
const handle = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  return (ms) => t.mock.timers.tick(ms)
}
// texto de 600 px numa linha de 200 px: excesso 400
const LONG = { textWidth: 600 }
const timing = marqueeTiming(400)

test('mensagem que cabe: sem animação e rodízio no tempo padrão (7 s)', (t) => {
  const tick = handle(t)
  const view = mount([ad('A'), ad('B')], { textWidth: 150 })
  assert.equal(view.stats.animations.length, 0)
  assert.equal(view.count(), '1/2')
  view.advance(6999, tick)
  assert.equal(view.count(), '1/2')
  view.advance(1, tick)
  assert.equal(view.count(), '2/2')
  assert.equal(view.stats.animations.length, 0)
  view.unmount()
})

test('marca e mensagem ficam separadas: a área rolável tem só a mensagem, e a marca aparece uma vez', () => {
  const view = mount([ad('A'), ad('B')], LONG)
  assert.equal(view.text(), 'Oferta A')
  assert.equal(view.partner(), 'Marca A')
  assert.equal(view.count(), '1/2')
  view.unmount()
})

test('mensagem longa: uma animação só de transform, e a próxima campanha só entra depois da exibição completa', (t) => {
  const tick = handle(t)
  const view = mount([ad('A'), ad('B')], LONG)
  assert.equal(view.stats.animations.length, 1)
  const [animation] = view.stats.animations
  assert.equal(animation.options.duration, timing.totalMs)
  assert.equal(animation.options.iterations, 1)
  assert.equal(animation.options.easing, 'linear')
  assert.ok(
    animation.keyframes.every((f) =>
      Object.keys(f).every((k) => k === 'transform' || k === 'offset')
    )
  )
  assert.ok(timing.totalMs > 7000, 'a rolagem estende o tempo da campanha')
  // aos 7 s (tempo padrão) ainda está lendo a primeira
  view.advance(7000, tick)
  assert.equal(view.count(), '1/2')
  view.advance(timing.totalMs - 7000 - 1, tick)
  assert.equal(view.count(), '1/2')
  view.advance(1, tick)
  assert.equal(view.count(), '2/2')
  assert.equal(view.partner(), 'Marca B')
  assert.equal(animation.cancelled, true, 'a animação da campanha anterior foi cancelada')
  assert.equal(view.stats.animations.length, 2, 'a seguinte recebe a sua própria animação')
  view.unmount()
})

test('pausa por toque pausa animação e rodízio; ao soltar retoma de onde parou, sem recomeçar', (t) => {
  const tick = handle(t)
  const view = mount([ad('A'), ad('B')], LONG)
  const [animation] = view.stats.animations
  view.advance(3000, tick)
  view.touch()
  assert.equal(animation.playState, 'paused')
  view.advance(60000, tick) // parado, o tempo não passa para a campanha
  assert.equal(view.count(), '1/2')
  assert.equal(animation.currentTime, 3000)
  view.release()
  view.advance(4000, tick) // RESUME_AFTER_MS
  assert.equal(animation.playState, 'running')
  assert.equal(animation.currentTime, 3000 + 0, 'retomou do mesmo ponto')
  view.advance(timing.totalMs - 3000 - 1, tick)
  assert.equal(view.count(), '1/2')
  view.advance(1, tick)
  assert.equal(view.count(), '2/2')
  view.unmount()
})

test('aba oculta pausa a rolagem e o rodízio; ao voltar, continua', (t) => {
  const tick = handle(t)
  const view = mount([ad('A'), ad('B')], LONG)
  const [animation] = view.stats.animations
  view.advance(2000, tick)
  view.setHidden(true)
  assert.equal(animation.playState, 'paused')
  view.advance(120000, tick)
  assert.equal(view.count(), '1/2')
  view.setHidden(false)
  assert.equal(animation.playState, 'running')
  view.advance(timing.totalMs - 2000, tick)
  assert.equal(view.count(), '2/2')
  view.unmount()
})

test('uma só campanha: rolagem em laço, sem contador e sem timer de rodízio', (t) => {
  const tick = handle(t)
  const view = mount([ad('A')], LONG)
  assert.equal(view.stats.animations[0].options.iterations, Infinity)
  assert.equal(view.count(), null)
  view.advance(120000, tick)
  assert.equal(view.partner(), 'Marca A')
  view.unmount()
})

test('prefers-reduced-motion: sem animação nem rodízio automático; texto longo vira região rolável', (t) => {
  const tick = handle(t)
  const view = mount([ad('A'), ad('B')], { ...LONG, reduced: true })
  assert.equal(view.stats.animations.length, 0)
  assert.match(view.lineProps().className, /is-manual/)
  assert.equal(view.lineProps().tabIndex, 0)
  assert.match(view.lineProps()['aria-label'], /Mensagem completa/)
  view.advance(120000, tick)
  assert.equal(view.count(), '1/2')
  view.unmount()
})

test('reduced motion com texto que cabe: sem região rolável, sem foco extra', () => {
  const view = mount([ad('A'), ad('B')], { textWidth: 100, reduced: true })
  assert.doesNotMatch(view.lineProps().className, /is-manual/)
  assert.equal(view.lineProps().tabIndex, undefined)
  view.unmount()
})

test('sem Element.animate: cai no modo rolável à mão (nada some cortado)', () => {
  const view = mount([ad('A'), ad('B')], { ...LONG, animate: false })
  assert.equal(view.stats.animations.length, 0)
  assert.match(view.lineProps().className, /is-manual/)
  view.unmount()
})

test('mudar a largura recalcula o excesso: passa a caber, a animação sai e volta o tempo padrão', (t) => {
  const tick = handle(t)
  const view = mount([ad('A'), ad('B')], LONG)
  assert.equal(view.stats.animations.length, 1)
  view.resizeTo(700)
  assert.equal(view.stats.animations[0].cancelled, true)
  assert.equal(view.stats.animations.length, 1, 'não cria animação nova quando cabe')
  assert.doesNotMatch(view.lineProps().className, /is-scrolling/)
  view.advance(7000, tick)
  assert.equal(view.count(), '2/2')
  view.unmount()
})

test('desmontar cancela animação e observador, sem listener nem timer sobrando', (t) => {
  const tick = handle(t)
  const view = mount([ad('A'), ad('B')], LONG)
  view.unmount()
  assert.equal(view.stats.animations[0].cancelled, true)
  assert.equal(view.stats.observers, 0)
  assert.equal(view.stats.listeners, 0)
  assert.doesNotThrow(() => tick(60000))
})
