import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Causa raiz do "fundo branco no dark mode" (auditoria completa): BaseStyles (main.jsx) só seta
// data-color-mode/data-light-theme/data-dark-theme no <div data-portal-root> que ELA renderiza --
// todo overlay NATIVO do Primer (ActionMenu, Dialog, Tooltip, SelectPanel...) usa o Portal.js do
// próprio Primer, que acha esse <div> via `[data-portal-root]` e portaleia pra dentro dele, então
// herda o tema de graça. Já o nosso ModalSheet (ShareProgressDialog/TrainingPlanDialog/ficha do
// catálogo) dá createPortal() direto em document.body (pra escapar de overflow/stacking context
// de um ancestral -- ModalSheet.jsx), o que o deixa IRMÃO daquele <div>, não descendente -- <html>
// é o único ancestral comum. Por isso ThemeSync existe: espelha `data-light-theme`/`data-dark-theme`
// em <html> também. Antes desta correção, só data-color-mode era copiado -- sem as outras duas, o
// seletor `[data-color-mode="dark"][data-dark-theme="dark"]` do @primer/primitives nunca batia em
// <html>, então TODA variável `--bgColor-*`/`--fgColor-*`/`--borderColor-*` usada dentro de um
// ModalSheet ficava indefinida -- `background: var(--bgColor-default)` cai no valor inicial
// (transparent), deixando a página branca por trás aparecer no dark mode.
//
// `data-color-mode` em si continua com a fórmula ORIGINAL (sempre resolvido -- "light"/"dark",
// nunca o literal "auto"), de propósito: outros consumidores já leem esse atributo direto de
// <html> esperando um valor concreto, com "light" como fallback pra qualquer outra coisa --
// PublicHeaderMenu.jsx/PublicProductsIsland.jsx e regras de app.css como
// `[data-color-mode='dark']`/`[data-color-mode='light']`. Escrever "auto" ali quebraria esses
// consumidores em silêncio pra maioria de quem nunca trocou o tema manualmente.
let directory
let api

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'theme-sync-tests-'))
  const outfile = join(directory, 'theme-sync.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider } from '@primer/react'
        import { ThemeSync } from './ThemeSync.jsx'

        export const mount = (providerProps) => {
          let tree
          act(() => {
            tree = TestRenderer.create(createElement(ThemeProvider, providerProps, createElement(ThemeSync)))
          })
          return {
            update: (next) => act(() => tree.update(createElement(ThemeProvider, next, createElement(ThemeSync)))),
            unmount: () => act(() => tree.unmount()),
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  })
  api = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  // <html>/window reais não existem neste runner (Node puro, sem jsdom -- ver
  // RowActionsMenu.test.js) -- só o suficiente pra ThemeSync escrever e o Primer
  // (useSystemColorMode, por baixo de useTheme) não quebrar.
  globalThis.document = { documentElement: { dataset: {}, style: {} } }
  globalThis.window = globalThis.window || {}
  globalThis.window.matchMedia =
    globalThis.window.matchMedia ||
    (() => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }))
})

test('modo claro explícito: as 3 pernas do seletor do @primer/primitives batem em <html>', () => {
  const view = api.mount({ colorMode: 'day', dayScheme: 'light', nightScheme: 'dark' })
  const root = globalThis.document.documentElement
  assert.equal(root.dataset.colorMode, 'light')
  assert.equal(root.dataset.lightTheme, 'light')
  assert.equal(root.dataset.darkTheme, 'dark')
  assert.equal(root.style.colorScheme, 'light')
  view.unmount()
})

test('modo escuro explícito: data-dark-theme (a perna que faltava) agora é escrita em <html>', () => {
  const view = api.mount({ colorMode: 'night', dayScheme: 'light', nightScheme: 'dark' })
  const root = globalThis.document.documentElement
  assert.equal(root.dataset.colorMode, 'dark')
  assert.equal(root.dataset.lightTheme, 'light')
  assert.equal(root.dataset.darkTheme, 'dark')
  assert.equal(root.style.colorScheme, 'dark')
  view.unmount()
})

test('modo "auto" (padrão real de quem nunca trocou o tema), sistema em claro: data-color-mode é escrito como "light" -- NUNCA o literal "auto" (quebraria PublicHeaderMenu.jsx/PublicProductsIsland.jsx e as regras [data-color-mode=...] de app.css, que esperam um valor concreto)', () => {
  globalThis.window.matchMedia = () => ({
    matches: false, // prefers-color-scheme: dark não bate -- sistema em claro
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  })
  const view = api.mount({ colorMode: 'auto', dayScheme: 'light', nightScheme: 'dark' })
  const root = globalThis.document.documentElement
  assert.equal(root.dataset.colorMode, 'light')
  assert.equal(root.dataset.lightTheme, 'light')
  assert.equal(root.dataset.darkTheme, 'dark')
  view.unmount()
})

test('modo "auto" com o sistema operacional em escuro: resolve pra "dark" concreto -- mesmo caminho que corrige o fundo branco de quem nunca trocou o tema manualmente', () => {
  globalThis.window.matchMedia = (query) => ({
    matches: query.includes('dark'),
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  })
  const view = api.mount({ colorMode: 'auto', dayScheme: 'light', nightScheme: 'dark' })
  const root = globalThis.document.documentElement
  assert.equal(root.dataset.colorMode, 'dark')
  assert.equal(root.dataset.lightTheme, 'light')
  assert.equal(root.dataset.darkTheme, 'dark')
  assert.equal(root.style.colorScheme, 'dark')
  view.unmount()
})

test('trocar de tema em tempo real (usuário clica no toggle com um ModalSheet já montado) atualiza <html> de novo, sem precisar remontar nada', () => {
  const view = api.mount({ colorMode: 'day', dayScheme: 'light', nightScheme: 'dark' })
  const root = globalThis.document.documentElement
  assert.equal(root.dataset.colorMode, 'light')

  view.update({ colorMode: 'night', dayScheme: 'light', nightScheme: 'dark' })
  assert.equal(root.dataset.colorMode, 'dark')
  assert.equal(root.style.colorScheme, 'dark')
  view.unmount()
})

test('esquemas não-padrão (dayScheme/nightScheme customizados) são espelhados como vieram, nunca hardcoded "light"/"dark"', () => {
  const view = api.mount({ colorMode: 'night', dayScheme: 'light_high_contrast', nightScheme: 'dark_dimmed' })
  const root = globalThis.document.documentElement
  assert.equal(root.dataset.lightTheme, 'light_high_contrast')
  assert.equal(root.dataset.darkTheme, 'dark_dimmed')
  view.unmount()
})
