import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let render
let setFixture

// RecommendedSheetPanel com useSheetInsights.js e useDailyBanner.js stubados: o motor de
// recomendação (recommendSheet.js) e a rotação de fotos (dailyRotation.js) já têm testes
// próprios; aqui só interessa como o PAINEL reage a cada estado.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sheet-panel-tests-'))
  const outfile = join(directory, 'panel.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { RecommendedSheetPanel } from './RecommendedSheetPanel.jsx'
        import { __setFixture } from './useSheetInsights.js'
        export const setFixture = __setFixture
        export const render = () => renderToStaticMarkup(
          createElement(ThemeProvider, null, createElement(BaseStyles, null,
            createElement(MemoryRouter, null, createElement(RecommendedSheetPanel))))
        )
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
    plugins: [
      {
        name: 'panel-test-stubs',
        setup(context) {
          context.onResolve({ filter: /\.\/useSheetInsights\.js$/ }, () => ({
            path: 'use-insights',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /\.\/useDailyBanner\.js$/ }, () => ({
            path: 'use-banner',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^use-insights$/, namespace: 'stub' }, () => ({
            contents: `
              let fixture = { online: true, loading: true, error: null, hasSheets: false, recommendation: null, lastTrained: null, mostTrained: null, refresh: () => {} }
              export const __setFixture = (next) => { fixture = next }
              export const useSheetInsights = () => fixture
            `,
          }))
          context.onLoad({ filter: /^use-banner$/, namespace: 'stub' }, () => ({
            contents: `export const useDailyBanner = () => ({ name: 'home-banner-anilhas', alt: 'foto', width: 1024, height: 576 })`,
          }))
        },
      },
    ],
  })
  ;({ render, setFixture } = require(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('carregando: mostra um indicador, sem conteúdo nem botões ainda', () => {
  setFixture({
    online: true,
    loading: true,
    error: null,
    hasSheets: false,
    recommendation: null,
    lastTrained: null,
    mostTrained: null,
    refresh: () => {},
  })
  const html = render()
  assert.match(html, /workout-hero--loading/)
  assert.doesNotMatch(html, /Iniciar ficha/)
})

test('offline: aviso honesto e Treino livre, sem recomendação inventada', () => {
  setFixture({
    online: false,
    loading: false,
    error: null,
    hasSheets: true,
    recommendation: null,
    lastTrained: null,
    mostTrained: null,
    refresh: () => {},
  })
  const html = render()
  assert.match(html, /Indisponível offline/)
  assert.match(html, />Treino livre</)
  assert.doesNotMatch(html, /Iniciar ficha/)
})

test('sem nenhuma ficha: "Criar primeira ficha"', () => {
  setFixture({
    online: true,
    loading: false,
    error: null,
    hasSheets: false,
    recommendation: null,
    lastTrained: null,
    mostTrained: null,
    refresh: () => {},
  })
  const html = render()
  assert.match(html, /Criar primeira ficha/)
})

test('com ficha recomendada: título, CTA direto, "Recomendado para hoje" e nenhum card inferior sem dados', () => {
  setFixture({
    online: true,
    loading: false,
    error: null,
    hasSheets: true,
    recommendation: {
      sheet: { id: 's1', name: 'Treino A — Peito + Tríceps', weekdays: [1, 3, 5] },
      reason: 'today',
      lastDate: '2026-10-22',
    },
    lastTrained: null,
    mostTrained: null,
    refresh: () => {},
  })
  const html = render()
  assert.match(html, /Treino A — Peito \+ Tríceps/)
  assert.match(html, /href="\/novo-treino\?ficha=s1"/)
  assert.match(html, /Recomendado para hoje/)
  assert.match(html, /Próximo treino sugerido/)
  assert.doesNotMatch(
    html,
    /sheet-insights-row/,
    'sem última treinada/mais treinada, a linha some, não fica vazia'
  )
})

test('com histórico: mostra última ficha treinada e mais treinada no mês, sem inventar dado que falta', () => {
  setFixture({
    online: true,
    loading: false,
    error: null,
    hasSheets: true,
    recommendation: {
      sheet: { id: 's1', name: 'Treino A', weekdays: [] },
      reason: 'fallback',
      lastDate: null,
    },
    lastTrained: { sheet: { id: 's3', name: 'Treino C — Pernas' }, date: '2026-10-22' },
    mostTrained: {
      sheet: { id: 's2', name: 'Treino B — Costas' },
      count: 4,
      lastDate: '2026-10-23',
    },
    refresh: () => {},
  })
  const html = render()
  assert.match(html, /ÚLTIMA FICHA UTILIZADA/)
  assert.match(html, /Treino C — Pernas/)
  assert.match(html, /MAIS DIAS COM REGISTROS/)
  assert.match(html, /Treino B — Costas/)
  assert.match(html, /4 dias com registros neste mês/)
  assert.doesNotMatch(html, /Recomendado para hoje/)
  assert.doesNotMatch(
    html,
    /Próximo treino sugerido/,
    'ficha sem dias cadastrados: não mostra a linha'
  )
})

test('atividade parcial não é apresentada como conclusão e avisa a limitação offline', () => {
  const html = render()
  assert.match(html, /não comprova conclusão da ficha/)
  assert.match(html, /fila offline/)
  assert.doesNotMatch(html, /execuções neste mês|sessões concluídas|Última execução/)
})
