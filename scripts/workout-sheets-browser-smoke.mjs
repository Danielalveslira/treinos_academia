// Real routes, hooks, Supabase HTTP client, services and WorkoutForm against a synthetic RPC
// HTTP server. PostgreSQL security/atomicity are tested separately by the official pgTAP CI.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const quick = process.argv.includes('--quick')
const root = resolve(import.meta.dirname, '..')
const vercelConfig = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'))
const spaRule = vercelConfig.rewrites.find((rule) => rule.source.startsWith('/:path(')).source
const spaRoutes = new RegExp('^/' + spaRule.slice('/:path('.length, -1) + '$')
const dir = await mkdtemp(join(tmpdir(), 'workout-sheets-'))
const evidence = join(root, 'docs/workout-sheets-evidence')
await mkdir(evidence, { recursive: true })
const sid = '99a00000-0000-0000-0000-000000000001'
const exercises = ['Supino oficial', 'Puxada oficial', 'Agachamento fora da ficha'].map(
  (name, i) => ({
    id: `99e00000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
    name,
    muscleGroup: i === 1 ? 'Costas' : 'Peito',
    type: 'strength',
    source: 'catalog',
    provider: 'evolutus_dataset',
    providerExerciseId: `test-${i}`,
    active: true,
    catalogAvailable: true,
  })
)
let personalLibrary
let sheets, reads, writes, fail, conflict
function reset() {
  personalLibrary = [...exercises]
  sheets = [
    {
      id: sid,
      user_id: 'a',
      name: 'Ficha A',
      goal: 'forca',
      goal_description: 'Minha meta',
      weekdays: [1, 3],
      revision: 1,
      sort_order: 0,
      archived_at: null,
      items: [1, 0].map((n, i) => ({
        id: `item-${i}`,
        exercise_id: exercises[n].id,
        exercise: exercises[n],
        sort_order: i,
        available: true,
        target_sets: 3,
        reps_min: 8,
        reps_max: 12,
        note: '',
      })),
    },
  ]
  reads = []
  writes = []
  fail = false
  conflict = false
}
reset()
const stubs = {
  '/supabase/config': `import {createClient} from '@supabase/supabase-js';export const supabase=createClient(window.location.origin,'synthetic-browser-test',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,init)=>fetch(url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)), 'x-test-user':window.__uid||'a'}})}})`,
  '/hooks/useAuth': `import {useSyncExternalStore} from 'react';const subscribe=f=>{window.addEventListener('test-account',f);return()=>window.removeEventListener('test-account',f)};export function useAuth(){const uid=useSyncExternalStore(subscribe,()=>window.__uid||'a');return {user:{uid},offlineLocal:false}}`,
  '/services/exercisesService': `export const listExercises=async()=>{window.__libraryReads=(window.__libraryReads||0)+1;return (await fetch('/__library')).json()};export const createCatalogExercise=async(uid,e)=>{const exercise={...e,id:crypto.randomUUID(),catalogAvailable:true};await fetch('/__library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(exercise)});return {added:true,exercise}};export const updateExercise=async()=>{};export const deleteExercise=async()=>{};export const saveExerciseOrder=async()=>{}`,
  '/hooks/useDashboard': `export const useDashboard=()=>({allWorkouts:[]})`,
  '/hooks/useWorkouts': `window.__workoutWrites=[];export const useWorkouts=()=>({workouts:[],add:async(values)=>{window.__workoutWrites.push(values);return{id:'real-row',synced:true}},save:async(id,values)=>{window.__workoutWrites.push(values);return{id,synced:true}}})`,
  '/hooks/useExerciseCatalogDetail.js': `export const useExerciseCatalogDetail=()=>{window.__guideReads=(window.__guideReads||0)+1;return {data:{instructions:['Movimento controlado'],images:[]},loading:false}}`,
  '/hooks/useExerciseCatalogSearch.js': `import {useEffect,useState} from 'react';const all=Array.from({length:40},(_,i)=>({id:'99c00000-0000-0000-0000-'+String(i+1).padStart(12,'0'),provider:'evolutus_dataset',providerExerciseId:'catalog-'+i,name:'Exercício do catálogo '+String(i+1).padStart(2,'0'),primaryMuscles:['peito'],secondaryMuscles:[],equipment:'barra',category:'forca',level:'iniciante',instructions:['Movimento controlado'],images:[],thumbnail:null}));export function useExerciseCatalogSearch({q,muscle,equipment,category,level}){const [page,setPage]=useState(1);useEffect(()=>{window.__catalogQueries=(window.__catalogQueries||0)+1;setPage(1)},[q,muscle,equipment,category,level]);const rows=all.filter(e=>!q||e.name.toLowerCase().includes(q.toLowerCase()));return {items:rows.slice(0,page*10),total:rows.length,loading:false,loadingMore:false,error:null,hasMore:rows.length>page*10,loadMore:()=>{window.__catalogLoads=(window.__catalogLoads||0)+1;setPage(n=>n+1)},queryTooShort:false,fromCache:false,isPartialCache:false}}`,
  '/hooks/useExerciseCatalogTaxonomy.js': `export const useExerciseCatalogTaxonomy=()=>({muscles:['peito'],equipment:['barra'],categories:['forca'],levels:['iniciante']})`,
}
let browser, server
try {
  await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{createBrowserRouter,RouterProvider,Routes,Route}from'react-router-dom';import{ThemeProvider,BaseStyles}from'@primer/react';import{ExercisesRouteProvider}from'./src/components/ExercisesRouteProvider';import {ThemeSync} from './src/components/ThemeSync';import Area from './src/pages/ExercisesArea';import Detail from './src/features/workoutSheets/WorkoutSheetDetailPage';import Editor from './src/features/workoutSheets/WorkoutSheetEditorPage';import NewWorkout from './src/pages/NewWorkout';import './src/styles/app.css';import '@primer/primitives/dist/css/functional/themes/light.css';import '@primer/primitives/dist/css/functional/themes/dark.css';createRoot(document.getElementById('root')).render(<ThemeProvider colorMode="auto" dayScheme="light" nightScheme="dark"><BaseStyles><ThemeSync/><RouterProvider router={createBrowserRouter([{path:"*",element:<ExercisesRouteProvider><main className="main-content"><Routes><Route path="/exercicios" element={<Area/>}/><Route path="/fichas/nova" element={<Editor/>}/><Route path="/fichas/:id/editar" element={<Editor/>}/><Route path="/fichas/:id" element={<Detail/>}/><Route path="/novo-treino" element={<NewWorkout/>}/></Routes></main></ExercisesRouteProvider>}])}/></BaseStyles></ThemeProvider>)`,
      resolveDir: root,
      loader: 'jsx',
    },
    bundle: true,
    minify: true,
    outfile: join(dir, 'app.js'),
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    plugins: [
      {
        name: 'synthetic-boundaries',
        setup(b) {
          b.onResolve({ filter: /.*/ }, ({ path }) => {
            const key = Object.keys(stubs).find((s) => path.endsWith(s))
            return key ? { path: key, namespace: 'stub' } : undefined
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
  const assets = Object.fromEntries(
    await Promise.all(
      ['app.js', 'app.css'].map(async (name) => [name, gzipSync(await readFile(join(dir, name)))])
    )
  )
  server = createServer(async (req, res) => {
    if (req.url === '/__library') {
      if (req.method === 'POST') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        personalLibrary.push(JSON.parse(Buffer.concat(chunks).toString()))
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(personalLibrary))
      return
    }
    if (req.url === '/__benchmark') {
      reset()
      const template = sheets[0]
      sheets = Array.from({ length: 40 }, (_, n) => ({
        ...structuredClone(template),
        id: n === 0 ? sid : crypto.randomUUID(),
        name: `Ficha de volume ${n + 1}`,
        items: Array.from({ length: 40 }, (_, i) => {
          const exerciseId = crypto.randomUUID()
          return {
            id: crypto.randomUUID(),
            exercise_id: exerciseId,
            sort_order: i,
            available: true,
            exercise: { ...exercises[i % 3], id: exerciseId, name: `Exercício oficial ${i + 1}` },
          }
        }),
      }))
      res.end('ok')
      return
    }
    if (req.url === '/__reset') {
      reset()
      res.end('ok')
      return
    }
    if (req.url === '/__fail') {
      fail = true
      res.end('ok')
      return
    }
    if (req.url === '/__conflict') {
      conflict = true
      res.end('ok')
      return
    }
    if (req.url === '/__state') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ reads, writes, sheets }))
      return
    }
    if (req.url.startsWith('/rest/v1/rpc/')) {
      const name = req.url.split('/').at(-1)
      const chunks = []
      for await (const c of req) chunks.push(c)
      const args = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      const uid = req.headers['x-test-user'] || 'a'
      reads.push(name)
      const sheet = sheets.find(
        (s) => s.id === (args.p_sheet_id || args.p_source_id) && s.user_id === uid
      )
      res.setHeader('Content-Type', 'application/json')
      const err = (message) => {
        res.statusCode = 400
        res.end(JSON.stringify({ code: 'P0001', message }))
      }
      if (name === 'list_my_workout_sheets') {
        res.end(
          JSON.stringify(
            sheets
              .filter(
                (s) => s.user_id === uid && Boolean(s.archived_at) === Boolean(args.p_archived)
              )
              .map((s) => ({
                ...s,
                items: undefined,
                exercise_count: s.items.length,
                muscle_groups: ['Peito', 'Costas'],
              }))
          )
        )
        return
      }
      if (name === 'create_workout_sheet') {
        const prior = sheets.find((s) => s.request === args.p_request_id && s.user_id === uid)
        if (prior) {
          res.end(JSON.stringify(prior))
          return
        }
        const created = {
          id: crypto.randomUUID(),
          user_id: uid,
          request: args.p_request_id,
          name: args.p_name,
          goal: args.p_goal,
          goal_description: args.p_description,
          weekdays: args.p_weekdays,
          items: args.p_items.map((i) => ({
            ...i,
            id: crypto.randomUUID(),
            exercise: personalLibrary.find((e) => e.id === i.exercise_id),
            available: true,
          })),
          revision: 1,
          sort_order: sheets.length,
          archived_at: null,
        }
        sheets.push(created)
        writes.push(name)
        res.end(JSON.stringify(created))
        return
      }
      if (!sheet) {
        err('SHEET_NOT_FOUND')
        return
      }
      if (name === 'get_my_workout_sheet') {
        if (
          args.p_for_execution &&
          (sheet.archived_at || !sheet.items.length || sheet.items.some((i) => !i.available))
        )
          err('SHEET_NOT_READY')
        else res.end(JSON.stringify(sheet))
        return
      }
      if (name === 'save_workout_sheet') {
        if (fail) {
          fail = false
          res.statusCode = 503
          res.end(JSON.stringify({ message: 'network interruption' }))
          return
        }
        if (conflict) {
          conflict = false
          sheet.revision++
          sheet.goal_description = 'Outra aba'
          err('SHEET_VERSION_CONFLICT')
          return
        }
        if (sheet.revision !== args.p_expected_revision) {
          err('SHEET_VERSION_CONFLICT')
          return
        }
        Object.assign(sheet, args.p_metadata, {
          revision: sheet.revision + 1,
          items: args.p_items.map((i) => ({
            ...i,
            id: crypto.randomUUID(),
            exercise: personalLibrary.find((e) => e.id === i.exercise_id),
            available: true,
          })),
        })
        writes.push(name)
        res.end(JSON.stringify(sheet))
        return
      }
      if (name === 'set_workout_sheet_archived') {
        sheet.archived_at = args.p_archived ? new Date().toISOString() : null
        sheet.revision++
        writes.push(name)
        res.end(JSON.stringify(sheet))
        return
      }
      if (name === 'duplicate_workout_sheet') {
        const copy = structuredClone(sheet)
        copy.id = crypto.randomUUID()
        copy.name += ' (cópia)'
        copy.revision = 1
        sheets.push(copy)
        writes.push(name)
        res.end(JSON.stringify(copy))
        return
      }
      err('UNKNOWN_RPC')
      return
    }
    const name = req.url.split('?')[0].slice(1)
    if (assets[name]) {
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/css')
      res.setHeader('Content-Encoding', 'gzip')
      res.end(assets[name])
      return
    }
    if (!spaRoutes.test(req.url.split('?')[0])) {
      res.statusCode = 404
      res.end('No SPA rewrite for this route')
      return
    }
    res.setHeader('Content-Type', 'text/html')
    res.end(
      '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script src="/app.js"></script></body></html>'
    )
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: process.env.CHROMIUM_PATH,
  })
  const results = []
  for (const theme of quick ? ['light'] : ['light', 'dark'])
    for (const width of quick ? [390] : [320, 360, 390, 768, 1280]) {
      await fetch(origin + '/__reset')
      const height = width === 320 ? 568 : width === 360 ? 740 : 900
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: theme,
        isMobile: width < 768,
        hasTouch: width < 768,
      })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const errors = [],
        images = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('request', (req) => {
        if (req.resourceType() === 'image') images.push(req.url())
      })
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: 200000,
        uploadThroughput: 100000,
      })
      const start = Date.now()
      await page.goto(origin + '/exercicios')
      await page.getByRole('heading', { name: 'Minhas fichas', exact: true }).waitFor()
      await page.getByRole('link', { name: 'Ficha A', exact: true }).waitFor()
      const listMs = Date.now() - start
      assert.equal(await page.evaluate(() => document.documentElement.dataset.colorMode), theme)
      const background = await page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor
      )
      const channels = background.match(/\d+/g).map(Number)
      assert.ok(
        theme === 'dark'
          ? channels.slice(0, 3).every((n) => n < 100)
          : channels.slice(0, 3).every((n) => n > 200),
        `theme background is correct: ${background}`
      )
      assert.equal(images.length, 0, 'cards do not fetch images')
      assert.deepEqual(reads, ['list_my_workout_sheets'])
      assert.equal(
        await page.evaluate(() => window.__libraryReads || 0),
        0,
        'sheet list never queries the personal library'
      )
      await page.getByRole('link', { name: 'Ficha A', exact: true }).click()
      await page.getByRole('heading', { name: 'Ficha A', exact: true }).waitFor()
      // Linhas compactas (índice + nome + meta), não um card grande por exercício.
      assert.deepEqual(await page.locator('.sheet-row-name').allTextContents(), [
        'Puxada oficial',
        'Supino oficial',
      ])
      assert.equal(await page.getByText('Agachamento fora da ficha', { exact: true }).count(), 0)
      assert.equal(images.length, 0, 'details do not eagerly fetch media')
      assert.equal(
        await page.evaluate(() => window.__guideReads || 0),
        0,
        'guides are fetched only on demand'
      )
      // Tocar a linha (não um botão "Ver execução de [nome inteiro]") abre o guia.
      await page
        .getByRole('button', { name: 'Ver instruções e execução de Puxada oficial', exact: true })
        .click()
      const guide = page.getByRole('dialog', { name: 'Puxada oficial', exact: true })
      await guide.waitFor()
      await guide.getByText('Movimento controlado', { exact: true }).waitFor()
      assert.ok(await page.evaluate(() => window.__guideReads > 0))
      await guide.getByRole('button', { name: 'Fechar', exact: true }).click()
      assert.equal(
        await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
        'Ver instruções e execução de Puxada oficial'
      )

      // Ao iniciar, vai direto para o PRIMEIRO exercício elegível na ordem da ficha
      // (Puxada oficial) -- sem tela intermediária de escolha solta.
      await page.getByRole('button', { name: 'Iniciar treino', exact: true }).click()
      await page.getByRole('button', { name: 'Exercício 1 de 2', exact: true }).waitFor()
      assert.equal(await page.locator('.workout-exercise-card').count(), 0)
      await page.getByText('Puxada oficial', { exact: true }).waitFor()
      assert.deepEqual(
        await page.evaluate(() => window.__workoutWrites),
        [],
        'starting creates no workout rows'
      )
      await page.getByText('Meta da ficha:', { exact: false }).waitFor()
      assert.deepEqual(
        await page.evaluate(() => window.__workoutWrites),
        [],
        'targets do not create sets'
      )
      assert.equal(
        await page.evaluate(() => window.__libraryReads || 0),
        0,
        'sheet detail/execution never load unrelated library exercises'
      )
      // Once validated online, the running form stays mounted during a connectivity loss.
      await page.getByRole('textbox', { name: 'Peso (kg)', exact: true }).fill('20')
      await page.getByRole('textbox', { name: 'Repetições', exact: true }).fill('10')
      await page.getByRole('button', { name: 'Concluir série', exact: true }).click()
      await page.waitForFunction(() => window.__workoutWrites.length === 1)
      assert.equal((await page.evaluate(() => window.__workoutWrites[0].setDetails)).length, 1)
      await context.setOffline(true)
      await page.waitForTimeout(250)
      assert.equal(await page.locator('.workout-form').count(), 1)
      await context.setOffline(false)
      await page.goto(origin + `/fichas/${sid}`)
      await page.getByRole('heading', { name: 'Ficha A', exact: true }).waitFor()
      await page.getByText('Puxada oficial', { exact: true }).waitFor()
      await page.getByRole('link', { name: 'Editar ficha', exact: true }).click()
      await page.getByRole('heading', { name: 'Editar ficha', exact: true }).waitFor()
      // The editor uses one bounded viewport for both sources; pagination must not grow the page.
      await page.getByRole('button', { name: 'Adicionar exercícios', exact: true }).click()
      const librarySearch = page.getByRole('searchbox', {
        name: 'Buscar na biblioteca',
        exact: true,
      })
      await librarySearch.fill('Agach')
      if (width < 768) await page.getByRole('button', { name: 'Catálogo', exact: true }).tap()
      else await page.getByRole('button', { name: 'Catálogo', exact: true }).click()
      const picker = page.getByRole('region', { name: 'Seletor de exercícios', exact: true })
      const catalogSearch = page.getByRole('searchbox', {
        name: 'Buscar no catálogo por nome',
        exact: true,
      })
      await catalogSearch.fill('Exercício do catálogo')
      await page.getByText('Exercício do catálogo 10', { exact: true }).waitFor()
      const beforePagination = await picker.evaluate((el) => ({
        height: el.clientHeight,
        scrollHeight: el.scrollHeight,
        pageHeight: document.documentElement.scrollHeight,
      }))
      assert.ok(beforePagination.height <= page.viewportSize().height * 0.6 + 1)
      assert.ok(beforePagination.scrollHeight > beforePagination.height)
      await picker.getByRole('button', { name: 'Carregar mais', exact: true }).click()
      await page.getByText('Exercício do catálogo 20', { exact: true }).waitFor()
      const afterPagination = await picker.evaluate((el) => ({
        height: el.clientHeight,
        pageHeight: document.documentElement.scrollHeight,
      }))
      assert.equal(afterPagination.height, beforePagination.height)
      assert.equal(
        afterPagination.pageHeight,
        beforePagination.pageHeight,
        'catalog pagination never grows the document'
      )
      await picker.hover()
      await picker.evaluate((el) => {
        el.scrollTop = 120
      })
      const outerScroll = await page.evaluate(() => scrollY)
      await page.mouse.wheel(0, 150)
      await page.waitForFunction(
        () => document.querySelector('[aria-label="Seletor de exercícios"]').scrollTop > 120
      )
      assert.equal(
        await page.evaluate(() => scrollY),
        outerScroll,
        'scrolling the catalog does not scroll the document'
      )
      await picker.evaluate((el) => {
        el.scrollTop = 220
      })
      const queries = await page.evaluate(() => window.__catalogQueries)
      await page.getByRole('button', { name: 'Biblioteca', exact: true }).click()
      assert.equal(await librarySearch.inputValue(), 'Agach')
      await page.getByRole('button', { name: 'Catálogo', exact: true }).click()
      assert.equal(await catalogSearch.inputValue(), 'Exercício do catálogo')
      assert.ok(
        await picker.evaluate((el) => el.scrollTop >= 200),
        'catalog scroll position survives source changes'
      )
      assert.equal(
        await page.evaluate(() => window.__catalogQueries),
        queries,
        'switching source does not refetch the catalog'
      )
      await picker.getByRole('button', { name: 'Meus exercícios', exact: true }).click()
      assert.equal(await librarySearch.inputValue(), 'Agach')
      await page.getByRole('button', { name: 'Catálogo', exact: true }).click()
      await page.getByRole('button', { name: 'Voltar à biblioteca', exact: true }).click()
      assert.equal(await librarySearch.inputValue(), 'Agach')
      await page.screenshot({
        path: join(evidence, `picker-library-${theme}-${width}.png`),
        fullPage: true,
      })
      await page.getByRole('button', { name: 'Catálogo', exact: true }).click()
      await page.screenshot({
        path: join(evidence, `picker-catalog-${theme}-${width}.png`),
        fullPage: true,
      })
      await page.getByRole('button', { name: 'Fechar seleção', exact: true }).click()
      const save = page.getByRole('button', { name: 'Salvar ficha', exact: true })
      assert.equal(await save.isDisabled(), true)
      await page.evaluate(() => {
        window.__paint = []
        document.addEventListener('input', () => {
          const start = performance.now()
          requestAnimationFrame(() => window.__paint.push(performance.now() - start))
        })
      })
      const nameInput = page.getByRole('textbox', { name: 'Nome obrigatório', exact: true })
      const mutationsBeforeTyping = writes.length
      await nameInput.fill('Modificada')
      assert.equal(await save.isEnabled(), true)
      await nameInput.fill('Ficha A')
      assert.equal(await save.isDisabled(), true)
      await nameInput.fill('Nome mantido sem rede')
      await context.setOffline(true)
      await page.getByText('Fichas exigem conexão.', { exact: false }).waitFor()
      assert.equal(await nameInput.inputValue(), 'Nome mantido sem rede')
      assert.equal(await save.isDisabled(), true)
      await context.setOffline(false)
      await page.waitForTimeout(300)
      assert.equal(await nameInput.inputValue(), 'Nome mantido sem rede')
      assert.equal(writes.length, mutationsBeforeTyping, 'typing never writes to server')
      async function dismissConfirmation(action) {
        const prompt = page.waitForEvent('dialog')
        const pending = action()
        const dialog = await prompt
        assert.equal(dialog.type(), 'confirm')
        await dialog.dismiss()
        await pending
      }
      await dismissConfirmation(() => page.evaluate(() => history.back()))
      await page.waitForTimeout(250)
      assert.ok(page.url().endsWith('/editar'), 'rejecting browser back preserves editor')
      assert.equal(
        await nameInput.inputValue(),
        'Nome mantido sem rede',
        'browser back must preserve the local draft'
      )
      assert.equal(await save.isEnabled(), true)
      // Browser Back and links ask before discarding; rejecting preserves local editing.
      await dismissConfirmation(() =>
        page.getByRole('button', { name: 'Voltar', exact: true }).click()
      )
      assert.equal(await nameInput.inputValue(), 'Nome mantido sem rede')
      await page.getByRole('button', { name: 'Subir Supino oficial', exact: true }).click()
      await fetch(origin + '/__fail')
      await save.click()
      await page.getByRole('alert').filter({ hasText: 'Não foi possível concluir' }).waitFor()
      assert.equal(await nameInput.inputValue(), 'Nome mantido sem rede')
      await fetch(origin + '/__conflict')
      await save.click()
      await page.getByRole('region', { name: 'Conflito de versões' }).waitFor()
      assert.equal(await nameInput.inputValue(), 'Nome mantido sem rede')
      await page
        .getByRole('button', { name: 'Manter minha edição para revisão', exact: true })
        .click()
      await save.click()
      await page.getByRole('heading', { name: 'Nome mantido sem rede', exact: true }).waitFor()
      assert.deepEqual(await page.locator('.sheet-row-name').allTextContents(), [
        'Supino oficial',
        'Puxada oficial',
      ])
      const inputPaintMs = await page.evaluate(() => window.__paint || [])
      await page.screenshot({
        path: join(evidence, `detail-${theme}-${width}.png`),
        fullPage: true,
      })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      assert.equal(overflow, false)
      await page.goto(origin + `/fichas/${sid}/editar`)
      await nameInput.waitFor()
      await page
        .getByRole('button', { name: 'Editar metas de Supino oficial', exact: true })
        .click()
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false
      )
      await page.screenshot({
        path: join(evidence, `editor-${theme}-${width}.png`),
        fullPage: true,
      })
      // Account changes immediately clear the prior account's hook result and editor state.
      await page.evaluate(() => {
        window.__uid = 'b'
        window.dispatchEvent(new Event('test-account'))
      })
      await page.getByRole('alert').filter({ hasText: 'sem permissão' }).waitFor()
      assert.equal(await page.locator('input[value="Nome mantido sem rede"]').count(), 0)
      await page.goto(origin + '/fichas/nova')
      await page.getByRole('heading', { name: 'Criar ficha', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Adicionar exercícios', exact: true }).waitFor()
      assert.equal(
        await page
          .getByRole('button', { name: 'Objetivo e descrição', exact: true })
          .getAttribute('aria-expanded'),
        'false'
      )
      assert.equal(
        await page
          .getByRole('button', { name: 'Dias sugeridos', exact: true })
          .getAttribute('aria-expanded'),
        'false'
      )
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false
      )
      await page.screenshot({
        path: join(evidence, `create-${theme}-${width}.png`),
        fullPage: true,
      })

      if (theme === 'light' && width === 390) {
        await page.evaluate(() => {
          window.__uid = 'a'
          window.dispatchEvent(new Event('test-account'))
        })
        await page.goto(origin + '/exercicios')
        await page.getByRole('link', { name: 'Nome mantido sem rede', exact: true }).waitFor()
        await page.getByText('Ações de Nome mantido sem rede', { exact: true }).click()
        await page.getByRole('button', { name: 'Duplicar', exact: true }).click()
        await page.getByRole('textbox', { name: 'Nome obrigatório', exact: true }).waitFor()
        assert.equal(
          await page.getByRole('textbox', { name: 'Nome obrigatório', exact: true }).inputValue(),
          'Nome mantido sem rede (cópia)'
        )
        await page.getByRole('button', { name: 'Voltar', exact: true }).click()
        await page.getByRole('link', { name: 'Voltar para minhas fichas', exact: true }).click()
        const card = page
          .locator('.sheet-card')
          .filter({ has: page.getByRole('link', { name: 'Nome mantido sem rede', exact: true }) })
        await card.locator('summary').click()
        await card.getByRole('button', { name: 'Arquivar', exact: true }).click()
        await page.getByRole('checkbox', { name: 'Mostrar arquivadas', exact: true }).check()
        const archivedCard = page
          .locator('.sheet-card')
          .filter({ has: page.getByRole('link', { name: 'Nome mantido sem rede', exact: true }) })
        await archivedCard.locator('summary').click()
        await archivedCard.getByRole('button', { name: 'Restaurar', exact: true }).click()
        await page.getByRole('checkbox', { name: 'Mostrar arquivadas', exact: true }).uncheck()
        await page.getByRole('button', { name: 'Criar ficha', exact: true }).click()
        const draftName = page.getByRole('textbox', { name: 'Nome obrigatório', exact: true })
        await draftName.fill('Rascunho novo')
        await page.getByRole('button', { name: 'Objetivo e descrição', exact: true }).click()
        await page
          .getByRole('combobox', { name: 'Objetivo opcional', exact: true })
          .selectOption('forca')
        await page
          .getByRole('textbox', { name: 'Descrição opcional', exact: true })
          .fill('Meta mobile')
        await page.getByRole('button', { name: 'Objetivo e descrição', exact: true }).click()
        await page.getByRole('button', { name: 'Objetivo e descrição', exact: true }).click()
        assert.equal(
          await page.getByRole('textbox', { name: 'Descrição opcional', exact: true }).inputValue(),
          'Meta mobile'
        )
        await page.getByRole('button', { name: 'Dias sugeridos', exact: true }).click()
        await page.getByRole('checkbox', { name: 'Ter', exact: true }).check()
        await page.getByRole('button', { name: 'Dias sugeridos', exact: true }).click()
        await page.getByRole('button', { name: 'Dias sugeridos', exact: true }).click()
        assert.equal(
          await page.getByRole('checkbox', { name: 'Ter', exact: true }).isChecked(),
          true
        )

        await page.getByRole('button', { name: 'Salvar ficha', exact: true }).click()
        await page.getByRole('heading', { name: 'Rascunho novo', exact: true }).waitFor()
        assert.equal(
          await page.getByRole('button', { name: 'Iniciar treino', exact: true }).isDisabled(),
          true
        )
        await page.getByRole('link', { name: 'Editar ficha', exact: true }).click()
        await page.getByRole('button', { name: 'Adicionar exercícios', exact: true }).click()
        await page.getByRole('button', { name: 'Catálogo', exact: true }).click()
        await page
          .getByRole('button', { name: 'Exercício do catálogo 01', exact: false })
          .first()
          .click()
        await page
          .getByRole('button', { name: 'Adicionar aos meus exercícios', exact: true })
          .click()
        await page.getByRole('button', { name: 'Fechar', exact: true }).click()
        await page.getByRole('button', { name: 'Voltar à biblioteca', exact: true }).click()
        await page.getByRole('button', { name: 'Adicionar Supino oficial', exact: true }).click()
        await page.getByRole('button', { name: 'Salvar ficha', exact: true }).click()
        await page.getByText('Supino oficial', { exact: true }).waitFor()
        assert.equal(
          await page.getByRole('button', { name: 'Iniciar treino', exact: true }).isEnabled(),
          true
        )
      }
      const flowReads = reads.length,
        flowWrites = writes.length
      let volume = null
      if (theme === 'light' && width === 390) {
        await fetch(origin + '/__benchmark')
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 150,
          downloadThroughput: 200000,
          uploadThroughput: 100000,
        })
        const start = Date.now()
        await page.goto(origin + '/exercicios')
        await page.getByRole('link', { name: 'Ficha de volume 40', exact: true }).waitFor()
        const list40Ms = Date.now() - start
        assert.equal(await page.locator('.sheet-card').count(), 40)
        assert.equal(await page.evaluate(() => window.__libraryReads || 0), 0)
        const editorStart = Date.now()
        await page.goto(origin + `/fichas/${sid}/editar`)
        const volumeName = page.getByRole('textbox', { name: 'Nome obrigatório', exact: true })
        await volumeName.waitFor()
        await page.getByRole('heading', { name: '40. Exercício oficial 40', exact: true }).waitFor()
        const editor40Ms = Date.now() - editorStart
        const mountedTargetFields = await page
          .locator('[data-sheet-item] input, [data-sheet-item] textarea')
          .count()
        assert.equal(mountedTargetFields, 0, 'collapsed targets are not mounted for 40 exercises')
        await page.evaluate(() => {
          window.__paint = []
          document.addEventListener('input', () => {
            const start = performance.now()
            requestAnimationFrame(() => window.__paint.push(performance.now() - start))
          })
        })
        for (let i = 0; i < 5; i++) await volumeName.fill('Ficha de volume alterada ' + i)
        await page.waitForTimeout(100)
        volume = {
          list40Ms,
          editor40Ms,
          mountedTargetFields,
          inputPaintMs: await page.evaluate(() => window.__paint),
          overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          heap: (await cdp.send('Runtime.getHeapUsage')).usedSize,
        }
        assert.equal(volume.overflow, false)
        console.log('VOLUME ' + JSON.stringify(volume))
      }
      const heap = await cdp.send('Runtime.getHeapUsage')
      assert.deepEqual(errors, [])
      results.push({
        theme,
        width,
        height,
        listMs,
        images: images.length,
        overflow,
        usedHeapBytes: heap.usedSize,
        inputPaintMs,
        pickerLayout: { before: beforePagination, after: afterPagination },
        volume,
        readRequests: flowReads,
        writeRequests: flowWrites,
      })
      await context.close()
      console.log(JSON.stringify(results.at(-1)))
    }
  await writeFile(
    join(evidence, quick ? 'browser-results-quick.json' : 'browser-results.json'),
    JSON.stringify(
      {
        fixture:
          'synthetic HTTP RPC server; real UI/client/services; CPU 4x; 150ms RTT; 200KB/s down',
        results,
      },
      null,
      2
    ) + '\n'
  )
} finally {
  await browser?.close()
  if (server) await new Promise((done) => server.close(done))
  await rm(dir, { recursive: true, force: true })
}
