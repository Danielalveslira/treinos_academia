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
const root = resolve(import.meta.dirname, '..')
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
let sheets, reads, writes, fail, conflict
function reset() {
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
  '/services/exercisesService': `export const listExercises=async()=>${JSON.stringify(exercises)};export const createCatalogExercise=async(uid,e)=>({added:true,exercise:e});export const updateExercise=async()=>{};export const deleteExercise=async()=>{};export const saveExerciseOrder=async()=>{}`,
  '/hooks/useDashboard': `export const useDashboard=()=>({allWorkouts:[]})`,
  '/hooks/useWorkouts': `window.__workoutWrites=[];export const useWorkouts=()=>({workouts:[],add:async(values)=>{window.__workoutWrites.push(values);return{id:'real-row',synced:true}},save:async(id,values)=>{window.__workoutWrites.push(values);return{id,synced:true}}})`,
  '/hooks/useExerciseCatalogDetail.js': `export const useExerciseCatalogDetail=()=>({data:{instructions:['Movimento controlado'],images:[]},loading:false})`,
  '/hooks/useExerciseCatalogSearch.js': `export const useExerciseCatalogSearch=()=>({items:[],loading:false,error:null,hasMore:false,loadMore:()=>{},retry:()=>{}})`,
  '/hooks/useExerciseCatalogTaxonomy.js': `export const useExerciseCatalogTaxonomy=()=>({data:{muscles:[],equipment:[],categories:[],levels:[]},loading:false})`,
}
let browser, server
try {
  await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{createBrowserRouter,RouterProvider,Routes,Route}from'react-router-dom';import{ThemeProvider,BaseStyles}from'@primer/react';import{ExercisesProvider}from'./src/contexts/ExercisesContext';import Area from './src/pages/ExercisesArea';import Detail from './src/features/workoutSheets/WorkoutSheetDetailPage';import Editor from './src/features/workoutSheets/WorkoutSheetEditorPage';import NewWorkout from './src/pages/NewWorkout';import './src/styles/app.css';import '@primer/primitives/dist/css/functional/themes/light.css';import '@primer/primitives/dist/css/functional/themes/dark.css';createRoot(document.getElementById('root')).render(<ThemeProvider colorMode="auto"><BaseStyles><RouterProvider router={createBrowserRouter([{path:"*",element:<ExercisesProvider><main className="main-content"><Routes><Route path="/exercicios" element={<Area/>}/><Route path="/fichas/nova" element={<Editor/>}/><Route path="/fichas/:id/editar" element={<Editor/>}/><Route path="/fichas/:id" element={<Detail/>}/><Route path="/novo-treino" element={<NewWorkout/>}/></Routes></main></ExercisesProvider>}])}/></BaseStyles></ThemeProvider>)`,
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
            exercise: exercises.find((e) => e.id === i.exercise_id),
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
            exercise: exercises.find((e) => e.id === i.exercise_id),
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
  for (const theme of ['light', 'dark'])
    for (const width of [320, 360, 390, 768, 1280]) {
      await fetch(origin + '/__reset')
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
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
      assert.equal(images.length, 0, 'cards do not fetch images')
      assert.deepEqual(reads, ['list_my_workout_sheets'])
      await page.getByRole('link', { name: 'Ficha A', exact: true }).click()
      await page.getByRole('heading', { name: 'Puxada oficial', exact: true }).waitFor()
      assert.deepEqual(await page.locator('.sheet-card h2').allTextContents(), [
        'Puxada oficial',
        'Supino oficial',
      ])
      assert.equal(await page.getByText('Agachamento fora da ficha', { exact: true }).count(), 0)
      assert.equal(images.length, 0, 'details do not eagerly fetch media')
      await page.getByRole('link', { name: 'Iniciar treino', exact: true }).click()
      await page.getByRole('heading', { name: 'Escolha o exercício', exact: true }).waitFor()
      assert.deepEqual(await page.locator('.workout-exercise-card strong').allTextContents(), [
        'Puxada oficial',
        'Supino oficial',
      ])
      assert.deepEqual(
        await page.evaluate(() => window.__workoutWrites),
        [],
        'starting creates no workout rows'
      )
      await page.getByRole('button', { name: 'Puxada oficial', exact: true }).click()
      await page.getByText('Metas da ficha (referência):', { exact: false }).waitFor()
      assert.deepEqual(
        await page.evaluate(() => window.__workoutWrites),
        [],
        'targets do not create sets'
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
      await page.getByRole('heading', { name: 'Puxada oficial', exact: true }).waitFor()
      await page.getByRole('link', { name: 'Editar ficha', exact: true }).click()
      await page.getByRole('heading', { name: 'Editar ficha', exact: true }).waitFor()
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
      page.once('dialog', (d) => d.dismiss())
      await page.evaluate(() => history.back())
      await page.waitForTimeout(250)
      assert.ok(page.url().endsWith('/editar'), 'rejecting browser back preserves editor')
      assert.equal(
        await nameInput.inputValue(),
        'Nome mantido sem rede',
        'browser back must preserve the local draft'
      )
      assert.equal(await save.isEnabled(), true)
      // Browser Back and links ask before discarding; rejecting preserves local editing.
      page.once('dialog', (d) => d.dismiss())
      await page.getByRole('button', { name: 'Voltar', exact: true }).click()
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
      assert.deepEqual(await page.locator('.sheet-card h2').allTextContents(), [
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
      await page.getByText('Editar metas de Supino oficial', { exact: true }).click()
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
        await page.getByRole('link', { name: 'Criar ficha', exact: true }).click()
        const draftName = page.getByRole('textbox', { name: 'Nome obrigatório', exact: true })
        await draftName.fill('Rascunho novo')
        await page.getByRole('button', { name: 'Salvar ficha', exact: true }).click()
        await page.getByRole('heading', { name: 'Rascunho novo', exact: true }).waitFor()
        assert.equal(
          await page
            .getByRole('link', { name: 'Iniciar treino', exact: true })
            .getAttribute('aria-disabled'),
          'true'
        )
        await page.getByRole('link', { name: 'Editar ficha', exact: true }).click()
        await page.getByRole('button', { name: 'Adicionar Supino oficial', exact: true }).click()
        await page.getByRole('button', { name: 'Salvar ficha', exact: true }).click()
        await page.getByRole('heading', { name: 'Supino oficial', exact: true }).waitFor()
        assert.equal(
          await page
            .getByRole('link', { name: 'Iniciar treino', exact: true })
            .getAttribute('aria-disabled'),
          null
        )
      }
      const heap = await cdp.send('Runtime.getHeapUsage')
      assert.deepEqual(errors, [])
      results.push({
        theme,
        width,
        listMs,
        images: images.length,
        overflow,
        usedHeapBytes: heap.usedSize,
        inputPaintMs,
        readRequests: reads.length,
        writeRequests: writes.length,
      })
      await context.close()
      console.log(JSON.stringify(results.at(-1)))
    }
  await writeFile(
    join(evidence, 'browser-results.json'),
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
