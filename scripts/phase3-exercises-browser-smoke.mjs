// Real library/context/preferences/catalog/workout UI with synthetic service responses.
// Database authorization is covered independently by official_exercises_only_test.sql.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'phase3-exercises-'))
const services = `
 const old={id:'old',name:'Legado pessoal',muscleGroup:'Peito',source:'custom',active:true,note:'Nota antiga'}
 const official={id:'official',name:'Oficial publicado',muscleGroup:'Peito',source:'catalog',provider:'evolutus_dataset',providerExerciseId:'pub',catalogId:'cat-pub',catalogAvailable:true,active:true,note:''}
 const query=new URLSearchParams(location.search)
 const rows=query.has('empty')?[]:query.has('legacyOnly')?[old]:[old,official]
 window.__writes=[]
 export const listExercises=async()=>rows.map(row=>({...row}))
 export async function createCatalogExercise(uid,item){const exercise={...item,id:'added',catalogAvailable:true};window.__writes.push({kind:'add',exercise});return {added:true,exercise}}
 export async function updateExercise(uid,id,patch){window.__writes.push({kind:'preferences',id,patch});Object.assign(rows.find(row=>row.id===id),patch)}
 export const deleteExercise=async()=>{}
 export const saveExerciseOrder=async()=>{}
`
const stubs = {
  '/services/exercisesService': services,
  '/hooks/useAuth': `export const useAuth=()=>({user:{uid:'local-user'},offlineLocal:false})`,
  '/hooks/useDashboard': `export const useDashboard=()=>({allWorkouts:[]})`,
  '/hooks/useWorkouts': `export const useWorkouts=()=>({workouts:[],add:async()=>({synced:true}),save:async()=>({synced:true})})`,
  '/hooks/useOnlineStatus': `export const useOnlineStatus=()=>true`,
  '/hooks/useExerciseCatalogSearch.js': `export const useExerciseCatalogSearch=()=>({items:[{id:'cat-new',name:'Oficial novo',provider:'evolutus_dataset',providerExerciseId:'new',primaryMuscles:['peito'],images:[],instructions:['Empurre'],category:'forca'}],total:1,loading:false,loadingMore:false,hasMore:false,queryTooShort:false,noQueryIntent:false})`,
  '/hooks/useExerciseCatalogTaxonomy.js': `export const useExerciseCatalogTaxonomy=()=>({muscles:[],equipment:[],categories:[],levels:[]})`,
  '/hooks/useExerciseCatalogDetail.js': `export const useExerciseCatalogDetail=()=>({data:null,loading:false,unavailable:true})`,
  '/services/economyService': `export const completeWorkoutSession=async()=>({});export const getMyEvocoinDay=async()=>({});export const completeWorkoutSheet=async()=>{throw new Error('Unexpected sheet completion in the free-workout catalog smoke')}`,
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
      import NewWorkout from './src/pages/NewWorkout.jsx'
      import './src/styles/app.css'
      import '@primer/primitives/dist/css/functional/themes/light.css'
      createRoot(document.getElementById('root')).render(<ThemeProvider><BaseStyles><BrowserRouter><ExercisesProvider><main className="main-content"><Routes><Route path="/novo-treino" element={<NewWorkout/>}/><Route path="*" element={<Exercises/>}/></Routes></main></ExercisesProvider></BrowserRouter></BaseStyles></ThemeProvider>)
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
  console.log('PHASE3_UI bundle ready')
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
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error('PHASE3_UI pageerror', error.message)
    })
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('PHASE3_UI console', message.text())
    })
    console.log(`PHASE3_UI width=${width} library`)
    await page.goto(origin + '/exercicios')
    await page.getByText('Legado pessoal', { exact: true }).waitFor()
    assert.equal(await page.getByText('Exercício antigo', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Criar personalizado', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Mais ações' }).first().click()
    await page.getByRole('menuitem', { name: 'Preferências' }).click()
    await page.getByRole('textbox', { name: 'Observação pessoal (opcional)' }).fill('Minha nota')
    assert.equal(await page.getByRole('textbox', { name: 'Nome', exact: true }).count(), 0)
    assert.equal(await page.getByRole('combobox', { name: 'Grupo muscular' }).count(), 0)
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    const preferences = (await page.evaluate(() => window.__writes)).find(
      (item) => item.kind === 'preferences'
    )
    assert.deepEqual(Object.keys(preferences.patch).sort(), ['active', 'note'])
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
    await page.getByRole('heading', { name: 'Catálogo Evolutus' }).waitFor()
    await page
      .getByRole('button', { name: /Adicionar/ })
      .last()
      .click()
    assert.equal(
      (await page.evaluate(() => window.__writes)).filter((item) => item.kind === 'add').length,
      1
    )
    console.log(`PHASE3_UI width=${width} empty workout`)
    await page.goto(origin + '/novo-treino?legacyOnly=1')
    await page.getByText('Nenhum exercício ativo', { exact: true }).waitFor()
    await page
      .getByRole('link', { name: 'Escolher no Catálogo Evolutus' })
      .or(page.getByRole('button', { name: 'Escolher no Catálogo Evolutus' }))
      .click()
    await page.getByRole('heading', { name: 'Catálogo Evolutus' }).waitFor()
    await page.goto(origin + '/novo-treino?exercicio=old')
    await page.getByRole('heading', { name: 'Qual grupo você vai treinar?' }).waitFor()
    assert.equal(await page.getByRole('button', { name: /Legado pessoal/ }).count(), 0)
    await page.getByRole('button', { name: /Peito/ }).click()
    await page.getByRole('button', { name: /Oficial publicado/ }).click()
    await page.getByText('Série 1 de 3', { exact: true }).waitFor()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false
    )
    assert.deepEqual(errors, [])
    console.log(
      `PHASE3_UI_OK width=${width} catalog=true legacyPreserved=true officialWorkout=true`
    )
    await page.close()
  }
} finally {
  if (browser) await browser.close()
  if (server) {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
  await rm(dir, { recursive: true, force: true })
}
