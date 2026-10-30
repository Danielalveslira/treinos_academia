import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let renderSheets
let renderDetail
let renderTreinar
let setFixture

// WorkoutSheetsPage, WorkoutSheetDetailPage e TreinarPage, com useWorkoutSheets.js e
// workoutSheetsService.js stubados (eles chamam supabase/config.js, que precisa de env do
// Vite e não existe aqui) -- a lógica real de normalização/erro já é coberta por
// workoutSheetValidation.test.js e workoutSheetsService.test.js.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sheets-pages-tests-'))
  const outfile = join(directory, 'pages.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter, Routes, Route } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import SheetsPage from './WorkoutSheetsPage.jsx'
        import DetailPage from './WorkoutSheetDetailPage.jsx'
        import TreinarPage from './TreinarPage.jsx'
        import { __setFixture } from './useWorkoutSheets.js'

        function wrap(children, path) {
          return createElement(ThemeProvider, null, createElement(BaseStyles, null,
            createElement(MemoryRouter, { initialEntries: [path] }, children)))
        }
        export const setFixture = __setFixture
        export const renderSheets = () => renderToStaticMarkup(wrap(createElement(SheetsPage), '/exercicios'))
        export const renderTreinar = () => renderToStaticMarkup(wrap(createElement(TreinarPage), '/treinar'))
        export const renderDetail = (id) => renderToStaticMarkup(wrap(
          createElement(Routes, null, createElement(Route, { path: '/fichas/:id', element: createElement(DetailPage) })),
          '/fichas/' + id,
        ))
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
        name: 'sheets-pages-stubs',
        setup(context) {
          context.onResolve({ filter: /\.\/useWorkoutSheets\.js$/ }, () => ({
            path: 'use-sheets',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /\.\/workoutSheetsService\.js$/ }, () => ({
            path: 'sheets-service',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /\/WorkoutExerciseGuide$/ }, () => ({
            path: 'guide',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^use-sheets$/, namespace: 'stub' }, () => ({
            contents: `
              let fixture = { data: null, loading: true, error: null, online: true }
              export const __setFixture = (next) => { fixture = next }
              export const useWorkoutSheets = () => ({ ...fixture, refresh: () => {} })
            `,
          }))
          context.onLoad({ filter: /^sheets-service$/, namespace: 'stub' }, () => ({
            contents: `
              export const getWorkoutSheet = async () => ({ items: [] })
              export const archiveWorkoutSheet = async () => {}
              export const duplicateWorkoutSheet = async () => ({ id: 'dup' })
              export const listWorkoutSheets = async () => []
              export const reorderWorkoutSheets = async () => {}
              export const sheetError = (error) => (error && error.message) || 'Erro'
            `,
          }))
          context.onLoad({ filter: /^guide$/, namespace: 'stub' }, () => ({
            contents: `export const WorkoutExerciseGuide = () => null`,
            loader: 'jsx',
          }))
        },
      },
    ],
  })
  ;({ renderSheets, renderDetail, renderTreinar, setFixture } = require(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

// --- WorkoutSheetsPage -------------------------------------------------------------------

test('sheets list: eligible sheet shows a direct "Iniciar" action besides details', () => {
  setFixture({
    data: [
      {
        id: 's1',
        name: 'Treino A',
        goal: 'hipertrofia',
        weekdays: [1, 3],
        archived_at: null,
        revision: 1,
        exercise_count: 3,
        muscle_groups: ['Peito'],
      },
    ],
    loading: false,
    error: null,
    online: true,
  })
  const html = renderSheets()
  assert.match(html, />Iniciar</)
  assert.match(html, />Detalhes</)
  assert.doesNotMatch(html, />Abrir</)
})

test('sheets list: draft (no exercises) shows no "Iniciar", only "Abrir" and the draft hint', () => {
  setFixture({
    data: [
      {
        id: 's2',
        name: 'Rascunho X',
        goal: null,
        weekdays: [],
        archived_at: null,
        revision: 1,
        exercise_count: 0,
        muscle_groups: [],
      },
    ],
    loading: false,
    error: null,
    online: true,
  })
  const html = renderSheets()
  assert.doesNotMatch(html, />Iniciar</)
  assert.match(html, />Abrir</)
  assert.match(html, /Rascunho — adicione um exercício para iniciar\./)
})

test('sheets list: empty state does not duplicate the header\'s "Criar ficha" CTA', () => {
  setFixture({ data: [], loading: false, error: null, online: true })
  const html = renderSheets()
  assert.equal((html.match(/>Criar ficha</g) || []).length, 1)
  assert.match(html, /Sua primeira ficha começa aqui/)
})

// --- WorkoutSheetDetailPage --------------------------------------------------------------

test('sheet detail: compact rows, no repeated "Sem metas definidas", no full-name execution button', () => {
  setFixture({
    data: {
      id: 's1',
      name: 'Treino A',
      archived_at: null,
      goal: 'hipertrofia',
      goal_description: '',
      weekdays: [1, 3],
      items: [
        {
          id: 'i1',
          exercise_id: 'squat',
          exercise: { id: 'squat', name: 'Agachamento' },
          target_sets: 3,
          reps_min: 8,
          reps_max: 12,
          rest_seconds: 90,
          available: true,
        },
        {
          id: 'i2',
          exercise_id: 'bench',
          exercise: { id: 'bench', name: 'Supino' },
          available: false,
        },
      ],
    },
    loading: false,
    error: null,
    online: true,
  })
  const html = renderDetail('s1')
  assert.doesNotMatch(html, /Sem metas definidas/)
  assert.doesNotMatch(html, />Ver execução de [^<]*</)
  assert.match(html, /aria-label="Ver instruções e execução de Agachamento"/)
  assert.match(html, /aria-label="Ver instruções e execução de Supino"/)
  assert.match(html, /class="sheet-row-index"[^>]*>1</)
  assert.match(html, /class="sheet-row-index"[^>]*>2</)
  assert.match(html, /Indisponível para novos treinos/)
  // Metadados em uma linha só, com separador compacto.
  assert.match(html, /class="sheet-meta-line">[^<]*Hipertrofia[^<]*·/)
})

test('sheet detail: start is blocked (disabled) while any item is unavailable', () => {
  setFixture({
    data: {
      id: 's1',
      name: 'Treino A',
      archived_at: null,
      goal: null,
      goal_description: '',
      weekdays: [],
      items: [
        {
          id: 'i2',
          exercise_id: 'bench',
          exercise: { id: 'bench', name: 'Supino' },
          available: false,
        },
      ],
    },
    loading: false,
    error: null,
    online: true,
  })
  const html = renderDetail('s1')
  const startButton = html.match(/<button[^>]*variant="primary"[^>]*>[\s\S]*?<\/button>/)[0]
  assert.match(startButton, /Iniciar treino/)
  assert.match(startButton, /disabled=""/)
})

// --- TreinarPage ---------------------------------------------------------------------------

test('treinar: lists active sheets with a direct "Iniciar" without free sessions', () => {
  setFixture({
    data: [
      {
        id: 's1',
        name: 'Treino A',
        goal: 'hipertrofia',
        exercise_count: 4,
        available: true,
      },
    ],
    loading: false,
    error: null,
    online: true,
  })
  const html = renderTreinar()
  assert.match(html, />Iniciar</)
  assert.doesNotMatch(html, />Treino livre</)
  assert.doesNotMatch(html, /Qual grupo você vai treinar/)
})

test('treinar: empty state offers "Criar ficha" only; no free creation', () => {
  setFixture({ data: [], loading: false, error: null, online: true })
  const html = renderTreinar()
  assert.match(html, /Nenhuma ficha ativa/)
  assert.match(html, />Criar ficha</)
  assert.doesNotMatch(html, />Treino livre</)
})
