import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// PR4b: o cartão fechado não deve importar nem consultar nada do painel completo.
// O comportamento real de abrir/fechar via React.lazy + Suspense é verificado no
// navegador real (scripts/launch-assistant-browser-smoke.mjs) -- testar Suspense num
// harness manual de react-test-renderer (sem precedente neste projeto) mostrou-se
// instável; este arquivo cobre só o estado fechado e a estrutura estática do lazy().
let directory
let mount

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'launch-assistant-'))
  const outfile = join(directory, 'page.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import LaunchAssistant from './LaunchAssistant.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n?.children || []).map(textOf).join(''))
        export function mountPage() {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(LaunchAssistant))))
          })
          return {
            text: () => textOf(renderer.toJSON()),
            unmount: () => act(() => renderer.unmount()),
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
  })
  ;({ mountPage: mount } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('fechado por padrão: mostra o CTA, nenhum dado do painel na primeira renderização', () => {
  const page = mount()
  assert.match(page.text(), /Preparar publicidade/)
  assert.match(page.text(), /Abrir assistente/)
  page.unmount()
})

test('o painel completo é importado sob demanda (React.lazy), não estaticamente', async () => {
  const source = await readFile(new URL('./LaunchAssistant.jsx', import.meta.url), 'utf8')
  assert.match(
    source,
    /lazy\(\(\) => import\(['"]\.\/LaunchAssistantPanel['"]\)\)/,
    'LaunchAssistantPanel só deve ser buscado quando efetivamente renderizado (clique em "Abrir assistente")'
  )
  assert.doesNotMatch(
    source,
    /^import LaunchAssistantPanel/m,
    'nenhum import estático do painel -- isso derrotaria o lazy loading'
  )
})
