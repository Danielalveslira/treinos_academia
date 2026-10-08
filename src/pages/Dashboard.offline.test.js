import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Home offline: "valor real = 0" x "indisponível offline". Hooks de dados trocados por fixtures; o resto
// (Dashboard, StreakCard, consistência) é o código real.
const require = createRequire(import.meta.url)
let directory
let api

const STUBS = {
  '/hooks/useHomeDashboard': `export const useHomeDashboard = () => globalThis.__home`,
  '/contexts/ExercisesContext': `export const useExercises = () => ({ exercises: [] })`,
  '/hooks/useAuth': `export const useAuth = () => globalThis.__auth`,
  '/hooks/useGlobalSponsoredAds': `export const useGlobalSponsoredAds = () => ({ bannerAds: [] })`,
  '/components/SponsoredAdBanner': `export const SponsoredAdBanner = () => null`,
  '/components/ResponsivePicture': `export const ResponsivePicture = () => null`,
  '/services/usersService': `export const saveTrainingPreferences = async () => {}`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dashboard-offline-'))
  const outfile = join(directory, 'page.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import Dashboard from './Dashboard.jsx'
        import { businessDayKey } from '../utils/businessDate.js'
        export { businessDayKey }
        export const render = () =>
          renderToStaticMarkup(
            createElement(ThemeProvider, null,
              createElement(BaseStyles, null, createElement(MemoryRouter, null, createElement(Dashboard)))))
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    bundle: true,
    write: true,
    outfile,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'error',
    define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_ANON_KEY: 'k' }) },
    plugins: [
      {
        name: 'stubs',
        setup(b) {
          for (const [suffix, contents] of Object.entries(STUBS)) {
            b.onResolve({ filter: new RegExp(`${suffix.replaceAll('/', '\\/')}$`) }, (args) => ({
              path: `${args.path}#stub`,
              namespace: 'stub',
            }))
            b.onLoad({ filter: new RegExp(`${suffix.replaceAll('/', '\\/')}#stub$`), namespace: 'stub' }, () => ({
              contents,
              loader: 'js',
            }))
          }
          b.onResolve({ filter: /\/supabase\/config$/ }, (args) => ({ path: args.path, namespace: 'supa' }))
          b.onLoad({ filter: /.*/, namespace: 'supa' }, () => ({ contents: 'export const supabase = {}' }))
        },
      },
    ],
  })
  api = require(outfile)
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

function setup({ progressAvailable, progressDays = [], offlineLocal = true }) {
  globalThis.__auth = {
    profile: { username: 'maria', trainingPreferences: null },
    user: { uid: 'u1' },
    offlineLocal,
    refreshProfile: async () => {},
  }
  globalThis.__home = {
    recentWorkouts: [],
    progressDays,
    progressAvailable,
    loading: false,
    error: null,
    refresh: () => {},
  }
}

test('offline SEM snapshot de atividade: "—" na semana, no volume e na consistência — nunca 0x, 0 kg nem "0 dias"', () => {
  setup({ progressAvailable: false })
  const html = api.render()
  assert.match(html, /Dias de treino nesta semana<\/span><strong>—<\/strong>/)
  assert.match(html, /Volume de carga · 7 dias<\/span><strong>—<\/strong>/)
  assert.match(html, /— dias de consistência/)
  assert.match(html, /Disponível quando houver conexão/)
  assert.doesNotMatch(html, />0x</)
  assert.doesNotMatch(html, />0 kg</)
  assert.doesNotMatch(html, /\b0 dias de consistência/)
  assert.doesNotMatch(html, /Melhor sequência/)
  assert.doesNotMatch(html, /Ver calendário/)
  assert.doesNotMatch(html, /Compartilhar progresso/)
})

test('offline COM snapshot: números reais restaurados (semana, volume e sequência)', () => {
  const today = api.businessDayKey()
  setup({
    progressAvailable: true,
    progressDays: [{ dateKey: today, workoutCount: 1, strengthVolumeKg: 800, exerciseStats: [] }],
  })
  const html = api.render()
  assert.match(html, /Dias de treino nesta semana<\/span><strong>1x<\/strong>/)
  assert.match(html, /Volume de carga · 7 dias<\/span><strong>800 kg<\/strong>/)
  assert.match(html, /1 dia de consistência/)
  assert.match(html, /Melhor sequência no ano/)
})

test('valor real ZERO (snapshot existe e não há treino) segue sendo "0x"/"0 kg": não confundir com indisponível', () => {
  setup({ progressAvailable: true, progressDays: [] })
  const html = api.render()
  assert.match(html, /Dias de treino nesta semana<\/span><strong>0x<\/strong>/)
  assert.match(html, /Volume de carga · 7 dias<\/span><strong>0 kg<\/strong>/)
  assert.match(html, /0 dias de consistência/)
})

test('online: nada muda — números do servidor e ações do cartão disponíveis', () => {
  const today = api.businessDayKey()
  setup({
    offlineLocal: false,
    progressAvailable: true,
    progressDays: [{ dateKey: today, workoutCount: 2, strengthVolumeKg: 1500, exerciseStats: [] }],
  })
  const html = api.render()
  assert.match(html, /<strong>1x<\/strong>/)
  assert.match(html, /1\.500 kg/)
  assert.match(html, /Ver calendário/)
})

test('a Home não exibe mais Profissionais/Locais (vitrine saiu da tela inicial)', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('./Dashboard.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /ProfessionalsDiscovery|REDE EVOLUTUS|profissionais/i)
  setup({ offlineLocal: false, progressAvailable: true })
  const html = api.render()
  assert.doesNotMatch(html, /Encontre profissionais|home-discovery/)
})

test('os diálogos pesados da Home são carregados sob demanda (fora do bundle inicial)', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('./Dashboard.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^import .*(ShareProgressDialog|ActivityCalendarDialog|TrainingPlanDialog)/m)
  assert.match(source, /import\('\.\.\/components\/ShareProgressDialog'\)/)
})
