import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let mount

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'spotlight-tests-'))
  const outfile = join(directory, 'spotlight.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { FeaturedSpotlight } from './FeaturedSpotlight.jsx'

        const textOf = (node) =>
          typeof node === 'string' ? node : (node.children || []).map(textOf).join('')

        // Ambiente do navegador falso, com contadores para provar "sem observador/timer sobrando".
        export function mount(statuses, { onOpen = () => {}, random, reduced = false, hidden = false } = {}) {
          const stats = { listeners: 0, observers: 0, disconnected: 0 }
          const media = { matches: reduced, handlers: new Set() }
          const docHandlers = new Set()
          let intersect = null
          globalThis.window = {
            matchMedia: () => ({
              get matches() { return media.matches },
              addEventListener: (_, h) => { stats.listeners += 1; media.handlers.add(h) },
              removeEventListener: (_, h) => { stats.listeners -= 1; media.handlers.delete(h) },
            }),
          }
          globalThis.document = {
            hidden,
            addEventListener: (_, h) => { stats.listeners += 1; docHandlers.add(h) },
            removeEventListener: (_, h) => { stats.listeners -= 1; docHandlers.delete(h) },
          }
          globalThis.IntersectionObserver = class {
            constructor(callback) { stats.observers += 1; intersect = callback }
            observe() {}
            disconnect() { stats.observers -= 1; stats.disconnected += 1 }
          }
          const element = (list) =>
            React.createElement(FeaturedSpotlight, { statuses: list, onOpen, random })
          let renderer
          act(() => { renderer = TestRenderer.create(element(statuses), { createNodeMock: () => ({}) }) })
          const wrap = () => renderer.root.findAll((n) => n.props.className?.startsWith?.('cd-spotlight-wrap'))[0]
          return {
            stats,
            json: () => renderer.toJSON(),
            label: () => {
              const nodes = renderer.root.findAll((n) => n.props.className === 'cd-spotlight-label')
              return nodes.length ? textOf(nodes[0]) : null
            },
            count: () => {
              const nodes = renderer.root.findAll((n) => n.props.className === 'cd-spotlight-count')
              return nodes.length ? textOf(nodes[0]) : null
            },
            hasNav: () => renderer.root.findAll((n) => n.props.className === 'cd-spotlight-nav').length > 0,
            tick: (ms, tickFn) => act(() => tickFn(ms)),
            next: () => act(() => renderer.root.findAll((n) => n.props.className === 'cd-spotlight-next')[0].props.onClick()),
            open: () => act(() => renderer.root.findAll((n) => n.props.className === 'cd-spotlight')[0].props.onClick()),
            hover: () => act(() => wrap().props.onMouseEnter()),
            leave: () => act(() => wrap().props.onMouseLeave()),
            focus: () => act(() => wrap().props.onFocus()),
            blur: () => act(() => wrap().props.onBlur()),
            rerender: (list) => act(() => renderer.update(element(list))),
            setReduced: (value) => { media.matches = value; act(() => media.handlers.forEach((h) => h())) },
            setHidden: (value) => { globalThis.document.hidden = value; act(() => docHandlers.forEach((h) => h())) },
            setInView: (value) => act(() => intersect([{ isIntersecting: value }])),
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

// gerador determinístico
function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}
const FAR = Date.now() + 30 * 86400000
const post = (id, extra = {}) => ({
  id,
  type: 'text',
  text: `texto ${id}`,
  authorUsername: id,
  promoted: true,
  promotedUntil: new Date(FAR),
  ...extra,
})
const handle = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  return (ms) => t.mock.timers.tick(ms)
}

test('0 destaques: nada é renderizado', (t) => {
  handle(t)
  const view = mount([])
  assert.equal(view.json(), null)
})

test('1 destaque: fixo, sem controles, sem timer, sem observador e sem listeners', (t) => {
  const tick = handle(t)
  const original = globalThis.setTimeout
  let timers = 0
  globalThis.setTimeout = (...args) => {
    timers += 1
    return original(...args)
  }
  try {
    const view = mount([post('a')])
    assert.match(view.label(), /@a/)
    assert.equal(view.hasNav(), false)
    view.tick(60000, tick)
    assert.match(view.label(), /@a/)
    assert.equal(timers, 0, 'nenhum setTimeout')
    assert.deepEqual(view.stats, { listeners: 0, observers: 0, disconnected: 0 })
  } finally {
    globalThis.setTimeout = original
  }
})

test('3 destaques: um por vez, ciclo completo sem repetição, reembaralha e o 1º do novo ciclo != último', (t) => {
  const tick = handle(t)
  for (let seed = 1; seed <= 30; seed += 1) {
    const view = mount([post('a'), post('b'), post('c')], { random: seeded(seed) })
    const seen = []
    for (let step = 0; step < 6; step += 1) {
      assert.equal(view.count().endsWith('/3'), true)
      seen.push(view.label())
      view.tick(7000, tick)
    }
    assert.deepEqual([...new Set(seen.slice(0, 3))].length, 3, 'ciclo 1 sem repetição')
    assert.deepEqual([...new Set(seen.slice(3, 6))].length, 3, 'ciclo 2 sem repetição')
    assert.notEqual(seen[3], seen[2], 'primeiro do ciclo 2 != último do ciclo 1')
    view.unmount()
  }
})

test('o indicador é a posição no ciclo: 1/3, 2/3, 3/3 e volta a 1/3', (t) => {
  const tick = handle(t)
  const view = mount([post('a'), post('b'), post('c')], { random: seeded(5) })
  const counts = []
  for (let i = 0; i < 4; i += 1) {
    counts.push(view.count())
    view.tick(7000, tick)
  }
  assert.deepEqual(counts, ['1/3', '2/3', '3/3', '1/3'])
  view.unmount()
})

test('navegação manual avança, pausa a rotação por 4 s e depois retoma', (t) => {
  const tick = handle(t)
  const view = mount([post('a'), post('b'), post('c')], { random: seeded(2) })
  assert.equal(view.count(), '1/3')
  view.next()
  assert.equal(view.count(), '2/3')
  view.tick(6999, tick)
  assert.equal(view.count(), '2/3', 'pausado logo após o toque')
  view.tick(4000, tick) // 4 s depois do toque a pausa termina e um novo ciclo de 7 s começa
  assert.equal(view.count(), '2/3')
  view.tick(7000, tick)
  assert.equal(view.count(), '3/3')
  view.unmount()
})

test('pausa com mouse, foco/teclado e toque; retoma depois', (t) => {
  const tick = handle(t)
  const view = mount([post('a'), post('b'), post('c')], { random: seeded(9) })
  view.hover()
  view.tick(30000, tick)
  assert.equal(view.count(), '1/3', 'mouse em cima: não gira')
  view.leave()
  view.tick(4000, tick)
  view.tick(7000, tick)
  assert.equal(view.count(), '2/3', 'saiu o mouse: retoma')
  view.focus()
  view.tick(30000, tick)
  assert.equal(view.count(), '2/3', 'foco do teclado: não gira')
  view.blur()
  view.tick(4000, tick)
  view.tick(7000, tick)
  assert.equal(view.count(), '3/3')
  view.unmount()
})

test('prefers-reduced-motion desliga a rotação (e religa ao mudar a preferência)', (t) => {
  const tick = handle(t)
  const view = mount([post('a'), post('b')], { reduced: true })
  view.tick(30000, tick)
  assert.equal(view.count(), '1/2')
  view.setReduced(false)
  view.tick(7000, tick)
  assert.equal(view.count(), '2/2')
  view.unmount()
})

test('aba oculta e card fora da área visível não giram', (t) => {
  const tick = handle(t)
  const view = mount([post('a'), post('b')], { hidden: true })
  view.tick(30000, tick)
  assert.equal(view.count(), '1/2', 'aba oculta')
  view.setHidden(false)
  view.setInView(false)
  view.tick(30000, tick)
  assert.equal(view.count(), '1/2', 'fora da tela')
  view.setInView(true)
  view.tick(7000, tick)
  assert.equal(view.count(), '2/2')
  view.unmount()
})

test('destaque que vence durante o rodízio sai na hora, sem pular os demais; sobrando um, fica fixo e sem controles', (t) => {
  const tick = handle(t)
  const soon = Date.now() + 10000
  const view = mount(
    [
      post('a', { promotedUntil: new Date(soon) }),
      post('b'),
      post('c', { promotedUntil: new Date(soon + 3000) }),
    ],
    { random: seeded(4) }
  )
  assert.equal(view.count().endsWith('/3'), true)
  view.tick(7000, tick)
  view.tick(3100, tick) // passou o vencimento de "a" (10 s)
  assert.equal(view.count().endsWith('/2'), true, 'a saiu da rotação')
  assert.doesNotMatch(String(view.label()), /@a$/)
  view.tick(3100, tick) // passou o vencimento de "c"
  assert.equal(view.hasNav(), false, 'só "b": fixo, sem controles')
  assert.match(view.label(), /@b/)
  view.unmount()
})

test('lista nova (trocou de comunidade) mostra só os novos; mesmo conteúdo em novo array não reinicia o timer', (t) => {
  const tick = handle(t)
  const view = mount([post('a'), post('b')], { random: seeded(6) })
  view.tick(6000, tick)
  view.rerender([post('a'), post('b')]) // novo array, mesmo conteúdo (re-render do feed)
  view.tick(1000, tick)
  assert.equal(view.count(), '2/2', 'a troca continuou no instante certo (7 s desde o início)')
  view.rerender([post('x'), post('y'), post('z')])
  assert.equal(view.count().endsWith('/3'), true)
  assert.match(view.label(), /@(x|y|z)/)
  view.unmount()
})

test('clicar no card abre a publicação do destaque atual', (t) => {
  handle(t)
  const opened = []
  const view = mount([post('a'), post('b')], {
    random: seeded(1),
    onOpen: (s) => opened.push(s.id),
  })
  const shown = view.label().replace(/^.*@/, '')
  view.open()
  assert.deepEqual(opened, [shown])
  view.unmount()
})

test('desmontar limpa timers, listeners e observador (sem atualização depois)', (t) => {
  const tick = handle(t)
  const view = mount([post('a'), post('b'), post('c')])
  assert.equal(view.stats.observers, 1)
  view.hover()
  view.leave() // deixa o timer de retomada pendente
  view.unmount()
  assert.deepEqual(view.stats, { listeners: 0, observers: 0, disconnected: 1 })
  assert.doesNotThrow(() => tick(60000))
})
