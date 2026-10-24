// Fase 4 do Catálogo Evolutus (docs/prompts/PROMPT_EVOLUTUS_FASE_4_CATALOGO_V2.md): confirma na
// interface REAL (Exercises.jsx + ExerciseCatalog.jsx reais, com os hooks de catálogo
// sintéticos) que a vitrine inicial aparece sem busca/filtro, que os atalhos/"Mais filtros"/"Uso
// offline" ficam no lugar certo, que o detalhe abre/fecha preservando a lista, e que nenhuma
// largura testada (320 a 1280, claro e escuro) tem rolagem horizontal. Autorização server-side é
// coberta independentemente por official_exercises_only_test.sql/exercise_reference_integrity_test.sql.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'phase4-catalog-'))
const screenshotsDir = resolve(import.meta.dirname, '..', '.tmp-phase4-screenshots')
await mkdir(screenshotsDir, { recursive: true })

// 6 exercícios: 2 com START+END (demonstração completa), 1 só com thumbnail (sem demo), 1 sem
// nenhuma imagem (placeholder), espalhados por músculos reais do atalho (peito/dorsais) -- nunca
// inventa um grupo que a taxonomia não reconhece.
const items = [
  {
    id: 'cat-1', provider: 'evolutus_dataset', providerExerciseId: 'bench-press', name: 'Supino Reto com Barra',
    primaryMuscles: ['peito'], secondaryMuscles: ['triceps'], equipment: 'barra', category: 'forca', level: 'iniciante',
    instructions: ['Deite no banco.', 'Desça a barra até o peito.', 'Empurre para cima.'],
    images: ['https://picsum.photos/seed/start1/200', 'https://picsum.photos/seed/end1/200'],
    thumbnail: 'https://picsum.photos/seed/thumb1/200',
  },
  {
    id: 'cat-2', provider: 'evolutus_dataset', providerExerciseId: 'lat-pulldown', name: 'Puxada Alta na Polia',
    primaryMuscles: ['dorsais'], secondaryMuscles: ['biceps'], equipment: 'polia', category: 'forca', level: 'intermediario',
    instructions: ['Sente no aparelho.', 'Puxe a barra até o peito.'],
    images: ['https://picsum.photos/seed/start2/200', 'https://picsum.photos/seed/end2/200'],
    thumbnail: 'https://picsum.photos/seed/thumb2/200',
  },
  {
    id: 'cat-3', provider: 'evolutus_dataset', providerExerciseId: 'thumb-only', name: 'Exercício Só com Miniatura',
    primaryMuscles: ['quadriceps'], secondaryMuscles: [], equipment: 'maquina', category: 'forca', level: 'avancado',
    instructions: ['Ajuste o banco.'],
    images: [],
    thumbnail: 'https://picsum.photos/seed/thumb3/200',
  },
  {
    id: 'cat-4', provider: 'evolutus_dataset', providerExerciseId: 'no-image', name: 'Exercício Sem Imagem Publicada',
    primaryMuscles: ['abdominais'], secondaryMuscles: [], equipment: null, category: 'forca', level: 'iniciante',
    instructions: [],
    images: [],
    thumbnail: null,
  },
]

const services = `
 const old={id:'old',name:'Legado pessoal',muscleGroup:'Peito',source:'custom',active:true,note:'Nota antiga'}
 window.__writes=[]
 export const listExercises=async()=>[old]
 export async function createCatalogExercise(uid,item){const exercise={...item,id:'added',catalogAvailable:true};window.__writes.push({kind:'add',exercise});return {added:true,exercise}}
 export async function updateExercise(uid,id,patch){window.__writes.push({kind:'preferences',id,patch})}
 export const deleteExercise=async()=>{}
 export const saveExerciseOrder=async()=>{}
`
const stubs = {
  '/services/exercisesService': services,
  '/hooks/useAuth': `export const useAuth=()=>({user:{uid:'local-user'},offlineLocal:false})`,
  '/hooks/useDashboard': `export const useDashboard=()=>({allWorkouts:[]})`,
  '/hooks/useWorkouts': `export const useWorkouts=()=>({workouts:[],add:async()=>({synced:true}),save:async()=>({synced:true})})`,
  '/hooks/useOnlineStatus': `export const useOnlineStatus=()=>true`,
  '/hooks/useExerciseCatalogSearch.js': `
    export function useExerciseCatalogSearch(args){
      const all=${JSON.stringify(items)}
      const filtered = all.filter((item)=>{
        if (args.muscle && !item.primaryMuscles.includes(args.muscle) && !(item.secondaryMuscles||[]).includes(args.muscle)) return false
        if (args.equipment && item.equipment !== args.equipment) return false
        if (args.q && !item.name.toLowerCase().includes(String(args.q).toLowerCase())) return false
        return true
      })
      return {
        items: filtered, total: filtered.length, loading: false, loadingMore: false, hasMore: false,
        loadMore: () => {}, error: null, queryTooShort: false, noQueryIntent: !args.q && !args.muscle && !args.equipment && !args.category && !args.level,
        fromCache: false, isPartialCache: false,
      }
    }
  `,
  '/hooks/useExerciseCatalogTaxonomy.js': `export const useExerciseCatalogTaxonomy=()=>({muscles:['peito','dorsais','quadriceps','abdominais'],equipment:['barra','polia','maquina'],categories:['forca'],levels:['iniciante','intermediario','avancado']})`,
  '/hooks/useExerciseCatalogDetail.js': `export const useExerciseCatalogDetail=()=>({data:null,loading:false,unavailable:true})`,
  '/services/economyService': `export const completeWorkoutSession=async()=>({});export const getMyEvocoinDay=async()=>({})`,
  '/services/offline/syncScheduler': `export const flushPending=async()=>({});export const requestSync=()=>{};export const announceOutboxChanged=()=>{}`,
  '/supabase/config': `export const supabase={}`,
}

let server
let browser
try {
  await build({
    stdin: {
      contents: `
      import React from 'react'
      import {createRoot} from 'react-dom/client'
      import {BrowserRouter,Routes,Route} from 'react-router-dom'
      import {ThemeProvider,BaseStyles} from '@primer/react'
      import {ExercisesProvider} from './src/contexts/ExercisesContext.jsx'
      import Exercises from './src/pages/Exercises.jsx'
      import './src/styles/app.css'
      import '@primer/primitives/dist/css/functional/themes/light.css'
      import '@primer/primitives/dist/css/functional/themes/dark.css'
      createRoot(document.getElementById('root')).render(<ThemeProvider colorMode="auto"><BaseStyles><BrowserRouter><ExercisesProvider><main className="main-content"><Routes><Route path="*" element={<Exercises/>}/></Routes></main></ExercisesProvider></BrowserRouter></BaseStyles></ThemeProvider>)
    `,
      resolveDir: root,
      loader: 'jsx',
    },
    bundle: true,
    outfile: join(dir, 'app.js'),
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    plugins: [
      {
        name: 'synthetic-services',
        setup(b) {
          b.onResolve({ filter: /.*/ }, ({ path }) => {
            const stub = Object.keys(stubs).find((suffix) => path.endsWith(suffix))
            return stub ? { path: stub, namespace: 'stub' } : undefined
          })
          b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
            contents: stubs[path],
            resolveDir: root,
            loader: 'jsx',
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  console.log('PHASE4_CATALOG bundle ready')
  server = createServer(async (req, res) => {
    const name = req.url.split('?')[0]
    if (name === '/app.js' || name === '/app.css') {
      res.setHeader(
        'Content-Type',
        name.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8'
      )
      res.end(await readFile(join(dir, name.slice(1))))
    } else
      res.end(
        '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script src="/app.js"></script></body></html>'
      )
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const widths = [320, 360, 390, 430, 768, 1280]
  for (const colorScheme of ['light', 'dark']) {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme })
      page.setDefaultTimeout(10000)
      const errors = []
      page.on('pageerror', (error) => {
        errors.push(error.message)
        console.error('PHASE4_CATALOG pageerror', error.message)
      })
      page.on('console', (message) => {
        if (message.type() === 'error') console.error('PHASE4_CATALOG console', message.text())
      })

      await page.goto(origin + '/exercicios')
      await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
      await page.getByRole('heading', { name: 'Catálogo Evolutus' }).waitFor()

      // 1) Vitrine inicial: os 4 exercícios aparecem SEM nenhuma busca/filtro.
      await page.getByText('Supino Reto com Barra', { exact: true }).waitFor()
      await page.getByText('Puxada Alta na Polia', { exact: true }).waitFor()
      assert.equal(await page.getByText('Busque por nome ou escolha um filtro', { exact: false }).count(), 0)

      // 2) Atalhos de músculo reais (nunca um grupo inventado).
      await page.getByRole('button', { name: 'Peito', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Dorsais', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Braços', exact: true }).count(), 0)

      // 3) "Mais filtros" e "Uso offline" ficam FECHADOS por padrão (details sem [open]).
      const moreFiltersOpen = await page.locator('details.catalog-more-filters').evaluate((el) => el.open)
      assert.equal(moreFiltersOpen, false)
      const offlineOpen = await page.locator('details.catalog-offline-toggle').evaluate((el) => el.open)
      assert.equal(offlineOpen, false)

      // 4) Card com start+end mostra o selo; card sem nenhuma imagem não trava nem some.
      await page
        .locator('.catalog-card', { has: page.getByText('Supino Reto com Barra', { exact: true }) })
        .getByText('Com demonstração')
        .waitFor()
      await page.getByText('Exercício Sem Imagem Publicada', { exact: true }).waitFor()

      // 5) Busca filtra e o botão de limpar restaura a vitrine.
      await page.getByPlaceholder('Buscar por nome do exercício').fill('Puxada')
      await page.getByText('Puxada Alta na Polia', { exact: true }).waitFor()
      assert.equal(await page.getByText('Supino Reto com Barra', { exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Limpar busca' }).click()
      await page.getByText('Supino Reto com Barra', { exact: true }).waitFor()

      // 6) Abrir o detalhe mostra instruções; fechar preserva a listagem por baixo.
      await page.getByRole('button', { name: /Supino Reto com Barra/ }).first().click()
      await page.getByText('Desça a barra até o peito.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Adicionar aos meus exercícios' }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByText('Desça a barra até o peito.', { exact: true }).waitFor({ state: 'detached' })
      await page.getByText('Supino Reto com Barra', { exact: true }).waitFor()
      await page.getByText('Puxada Alta na Polia', { exact: true }).waitFor()

      // 7) Nenhuma rolagem horizontal nesta largura.
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
      assert.equal(hasOverflow, false, `overflow horizontal em ${width}px (${colorScheme})`)

      assert.deepEqual(errors, [])
      await page.screenshot({ path: join(screenshotsDir, `catalog-${colorScheme}-${width}.png`) })
      console.log(`PHASE4_CATALOG_OK colorScheme=${colorScheme} width=${width}`)
      await page.close()
    }
  }
  await writeFile(join(screenshotsDir, 'README.txt'), 'Evidência visual da Fase 4 (Catálogo Evolutus) -- gerado por scripts/phase4-catalog-browser-smoke.mjs.\n')
} finally {
  if (browser) await browser.close()
  if (server) {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
  await rm(dir, { recursive: true, force: true })
}
