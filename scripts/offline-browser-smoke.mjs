// Chromium real, dados sintéticos, sem credenciais nem chamadas a Supabase real.
// Usa playwright-core só em dev e compila um canário isolado em /tmp.
import { deepStrictEqual } from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { chromium } from 'playwright-core'
import { DB_NAME, DB_VERSION } from '../src/services/offline/schema.js'
import manifest from '../legal/manifest.json' with { type: 'json' }
import digests from '../legal/approved-digests.json' with { type: 'json' }

const ROOT = resolve(import.meta.dirname, '..')
const USER_ID = 'a0000000-0000-4000-8000-00000000000a'
const EXERCISE_ID = 'e0000000-0000-4000-8000-000000000001'
const WORKOUT_ID = 'b0000000-0000-4000-8000-000000000001'
const MUTATION_ID = 'c0000000-0000-4000-8000-000000000001'
const LEGAL_VERSION = manifest.version
const LEGAL_DIGEST = digests[LEGAL_VERSION]
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function buildCanary(outDir) {
  const env = {
    ...process.env,
    VITE_SUPABASE_URL: 'https://offline-smoke.invalid',
    VITE_SUPABASE_ANON_KEY: 'offline-smoke-public-key',
    VITE_OFFLINE_READ_ENABLED: 'true',
    VITE_OFFLINE_WRITE_ENABLED: 'true',
    VITE_OFFLINE_COLD_START_ENABLED: 'true',
  }
  // Build only the app shell into the canary directory. npm run build appends
  // --outDir to the public-page generator after &&, leaving this directory empty.
  const result = spawnSync('node_modules/.bin/vite', ['build', '--outDir', outDir], {
    cwd: ROOT, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`Build do canário falhou:\n${result.stderr || result.stdout}`)
}

async function startStaticServer(dir) {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    // The canary build keeps Vite's app shell as index.html in its temporary output.
    const file = resolve(dir, `.${['/', '/app', '/app-shell.html'].includes(pathname) ? '/index.html' : pathname}`)
    if (!file.startsWith(`${dir}${sep}`)) {
      response.writeHead(403).end()
      return
    }
    let body
    try { body = readFileSync(file) } catch {
      // SPA navigation fallback. Arquivos ausentes falham em vez de receber HTML.
      if (extname(file)) { response.writeHead(404).end(); return }
      body = readFileSync(join(dir, 'index.html'))
    }
    response.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'text/html',
      'Cache-Control': 'no-store',
    }).end(body)
  })
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

async function seed(page, { snapshot = false } = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  await page.evaluate(({ dbName, dbVersion, userId, exerciseId, workoutId, mutationId, version, digest, snapshot, today }) =>
    new Promise((resolveDone, reject) => {
      const open = indexedDB.open(dbName, dbVersion)
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction(['offlineBootstrap', 'syncMeta', 'userExercises', 'workouts', 'outbox'], 'readwrite')
        const now = Date.now()
        tx.objectStore('offlineBootstrap').put({
          user_id: userId, schema_version: 1,
          profile: { id: userId, username: 'teste_offline', createdAt: '2026-10-01T10:00:00Z', accountStatus: 'active', trainingPreferences: null },
          email_verified: true, last_online_verified_at: now,
          legal: { accepted_version: version, accepted_digest: digest, accepted_at: '2026-10-05T10:00:00Z', last_seen_policy_version: version, last_verified_at: now },
          offline_access: { enabled: true, blocked_reason: null, revoked_locally_at: null }, updated_at: now,
        })
        tx.objectStore('syncMeta').put({ key: 'bootstrap:active-user', value: userId })
        tx.objectStore('syncMeta').put({ key: `user:${userId}:offline-rollout`, value: {
          offline_write: { enabled: true, rollout_percentage: 100 },
          offline_cold_start: { enabled: true, rollout_percentage: 100 },
        } })
        tx.objectStore('syncMeta').put({ key: `user:${userId}:exercises:syncedAt`, value: now })
        tx.objectStore('syncMeta').put({ key: `user:${userId}:workouts:syncedAt`, value: now })
        tx.objectStore('userExercises').put({ id: exerciseId, user_id: userId, name: 'Agachamento', muscle_group: 'Pernas', type: 'strength', note: '', active: true, source: 'catalog', provider: 'evolutus_dataset', provider_exercise_id: 'offline-fixture', catalog_id: 'f0000000-0000-4000-8000-000000000001', catalogAvailable: true, order: 0 })
        tx.objectStore('workouts').put({ id: workoutId, user_id: userId, exercise_id: exerciseId, date: '2026-10-05', created_at: '2026-10-05T10:00:00Z', type: 'strength', set_details: [{ weight: 20, reps: 10 }], sets: 1, note: '' })
        tx.objectStore('outbox').put({ mutation_id: mutationId, user_id: userId, seq: 1, entity_type: 'workout', entity_id: workoutId, operation: 'workout.update', payload: { exercise_id: exerciseId, date: '2026-10-05', type: 'strength', set_details: [{ weight: 20, reps: 10 }], sets: 1, note: '' }, dates: ['2026-10-05'], base_updated_at: null, created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:00:00Z', attempts: 0, last_attempt_at: null, next_attempt_at: null, last_error: null, status: 'pending' })
        if (snapshot) {
          // Snapshot AGREGADO da Home gravado pela última sessão ONLINE (saldo, EvoCoins do dia, atividade) e
          // o treino de hoje que ele descreve (o cache local do histórico acompanha o snapshot).
          tx.objectStore('workouts').put({ id: 'b0000000-0000-4000-8000-000000000002', user_id: userId, exercise_id: exerciseId, date: today, created_at: `${today}T09:00:00Z`, type: 'strength', set_details: [{ weight: 80, reps: 10 }], sets: 1, note: '' })
          tx.objectStore('syncMeta').put({ key: `user:${userId}:home-snapshot`, value: {
            schema_version: 1, user_id: userId, saved_at: now,
            wallet: { coinBalance: 20, lifetimeCoinsEarned: 35, cashBalance: 320, saved_at: now },
            daily_coins: { earned: 3, limit: 10, day: today, saved_at: now },
            progress: { start: '2025-12-01', end: '2026-12-31', saved_at: now, days: [
              { dateKey: today, workoutCount: 1, strengthVolumeKg: 800, exerciseStats: [{ exerciseId }] },
            ] },
          } })
        }
        tx.oncomplete = () => { db.close(); resolveDone() }
        tx.onerror = () => reject(tx.error)
      }
    }), {
    dbName: DB_NAME, dbVersion: DB_VERSION, userId: USER_ID, exerciseId: EXERCISE_ID,
    workoutId: WORKOUT_ID, mutationId: MUTATION_ID, version: LEGAL_VERSION, digest: LEGAL_DIGEST,
    snapshot, today,
  })
}

async function readLocal(page) {
  return page.evaluate(({ dbName, dbVersion, userId }) => new Promise((resolveDone, reject) => {
    const open = indexedDB.open(dbName, dbVersion)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(['outbox', 'offlineBootstrap'], 'readonly')
      const mutations = tx.objectStore('outbox').getAll()
      const bootstrap = tx.objectStore('offlineBootstrap').get(userId)
      tx.oncomplete = () => {
        db.close()
        resolveDone({ outbox: mutations.result.map((m) => [m.operation, m.status]), bootstrap: Boolean(bootstrap.result) })
      }
      tx.onerror = () => reject(tx.error)
    }
  }), { dbName: DB_NAME, dbVersion: DB_VERSION, userId: USER_ID })
}


// Sessão do Supabase JÁ no armazenamento do navegador (token válido): é o caso real do cold start -- o
// auth-js entrega o usuário sem rede e o app NÃO pode esperar por RPC nenhuma para abrir.
async function seedSupabaseSession(page, { expired = false } = {}) {
  await page.evaluate(({ userId, expired }) => {
    // expired: token vencido há horas (o normal de quem reabre o app na academia): o auth-js tenta renovar sem
    // rede, com backoff, por dezenas de segundos antes de entregar a sessão inicial.
    const expires = Math.floor(Date.now() / 1000) + (expired ? -7200 : 3600)
    localStorage.setItem('sb-offline-smoke-auth-token', JSON.stringify({
      access_token: 'a.b.c', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: expires,
      user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'offline@teste.dev', email_confirmed_at: '2026-10-01T10:00:00Z', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T10:00:00Z' },
    }))
  }, { userId: USER_ID, expired })
}

// Instala o SW ONLINE sem nenhuma pré-busca manual dos assets e confere o precache do build.
async function installOnline(browser, origin, outDir) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${origin}/app`)
  await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not activate within 30 seconds')), 30000)),
  ]))
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith('treinos-assets'))
    return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname)))).flat()
  })
  const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')
  const expected = [...JSON.parse(/const BOOT_ASSETS = (\[[^\]]*\])/.exec(sw)[1]), ...JSON.parse(/const OFFLINE_ASSETS = (\[[^\]]*\])/.exec(sw)[1])]
  assert(expected.length > 4, 'OFFLINE_ASSETS vazio: as telas essenciais não entraram no build do SW')
  for (const url of expected) assert(cached.includes(url), `Install não guardou ${url}`)
  return { context, page, expected }
}

// Observa o documento DESDE o primeiro instante: se "Você está sem conexão" aparecer em qualquer momento
// (nem que por milissegundos) ou o conteúdo do app ficar inerte, fica registrado em window.__flash.
async function watchOfflineFlash(page) {
  await page.addInitScript(() => {
    window.__flash = { blockText: false, inert: false }
    const check = () => {
      if ((document.body?.innerText || '').includes('Você está sem conexão')) window.__flash.blockText = true
      if (document.getElementById('app-content')?.inert) window.__flash.inert = true
    }
    new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true, characterData: true })
    const tick = () => { check(); requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
}

function watchProblems(page) {
  const problems = []
  const backend = []
  page.on('console', (message) => {
    if (/dynamically imported module|Failed to fetch dynamically/i.test(message.text())) problems.push(message.text())
  })
  page.on('pageerror', (error) => {
    if (/dynamically imported module/i.test(error.message)) problems.push(error.message)
  })
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.startsWith('/assets/')) problems.push(`asset falhou: ${request.url()}`)
  })
  page.on('request', (request) => {
    if (request.url().includes('offline-smoke.invalid')) backend.push(request.url())
  })
  page.on('websocket', (socket) => backend.push(socket.url()))
  return { problems, backend }
}

// A saudação varia por dia e pode legitimamente não interpolar o nome do perfil.
// A Home está pronta quando seu cabeçalho está visível e preenchido; os asserts
// seguintes continuam conferindo saldo, atividade, sessão local, assets e outbox.
async function waitForDashboard(page) {
  await page.locator('.dashboard-greeting h1').filter({ hasText: /\S/ }).waitFor({ timeout: 15_000 })
}

const headerBalances = (page) => page.locator('.wallet-badge-value').allTextContents()
const homeStrip = async (page) => ({
  week: (await page.locator('.performance-strip div').nth(0).locator('strong').textContent())?.trim(),
  volume: (await page.locator('.performance-strip div').nth(1).locator('strong').textContent())?.trim(),
})

// Reproduz o bug real: NADA é pré-buscado à mão. O Service Worker é a única fonte dos chunks; sessão do
// Supabase presente; PWA reaberto sem rede; Home (já preenchida) -> Treino -> detalhe do exercício -> registro.
async function coldStartWithoutManualWarmup(browser, origin, outDir) {
  const { context, page: first, expected } = await installOnline(browser, origin, outDir)
  await seed(first, { snapshot: true })
  await seedSupabaseSession(first)
  await first.close()

  await context.setOffline(true)
  const page = await context.newPage()
  await watchOfflineFlash(page)
  const { problems, backend } = watchProblems(page)

  await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Modo offline: você entrou com os dados salvos neste aparelho.', { exact: false }).waitFor({ timeout: 15_000 })
  await waitForDashboard(page)
  // Home JÁ preenchida com o último valor conhecido (nada de 0 EvoCash -> 320 EvoCash).
  deepStrictEqual(await headerBalances(page), ['20', '320'], 'header sem o último saldo conhecido')
  deepStrictEqual(await homeStrip(page), { week: '1x', volume: '800 kg' }, 'Home sem a atividade restaurada')
  assert((await page.getByText('1 dia de consistência', { exact: false }).count()) === 1, 'sequência não restaurada')
  const flash = await page.evaluate(() => window.__flash)
  assert(!flash.blockText, '"Você está sem conexão" apareceu (flash) durante o cold start')
  assert(!flash.inert, 'Conteúdo do app ficou inerte durante o cold start')
  await page.getByText('1 alteração salva neste aparelho', { exact: false }).first().waitFor({ timeout: 15_000 })

  await page.locator('a[href="/novo-treino"]').first().click()
  await page.locator('.muscle-group-card').first().waitFor({ timeout: 15_000 })
  // Detalhe do exercício: o chunk lazy precisa vir do cache (a tela pode mostrar seu próprio erro de dados).
  await page.goto(`${origin}/exercicios/${EXERCISE_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  assert((await page.getByText('Esta área ainda não está disponível offline', { exact: false }).count()) === 0, 'Detalhe do exercício caiu no fallback "indisponível offline"')
  await page.goto(`${origin}/historico`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  await page.goto(`${origin}/novo-treino`, { waitUntil: 'domcontentloaded' })
  await page.locator('.muscle-group-card').first().click()
  await page.locator('.workout-exercise-card').first().click()
  await page.getByLabel('Peso (kg)').fill('30')
  await page.getByLabel('Repetições').fill('8')
  await page.getByRole('button', { name: 'Concluir série' }).click()
  // The current form saves each completed set immediately (rowSaver). There is
  // no separate "Finalizar exercício" button; verify the persisted outbox below.
  await page.waitForFunction(async ({ dbName, dbVersion }) => new Promise((resolveDone) => {
    const open = indexedDB.open(dbName, dbVersion)
    open.onsuccess = () => {
      const db = open.result
      const count = db.transaction('outbox').objectStore('outbox').count()
      count.onsuccess = () => { db.close(); resolveDone(count.result >= 2) }
    }
  }), { dbName: DB_NAME, dbVersion: DB_VERSION })
  // O que acabou de ser registrado offline conta na Home (treino local junto do snapshot).
  await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' })
  await waitForDashboard(page)
  deepStrictEqual(await headerBalances(page), ['20', '320'])

  assert(problems.length === 0, `Falhas de chunk/asset offline:\n${problems.join('\n')}`)
  assert(backend.length === 0, `Boot offline tentou falar com o backend/Realtime:\n${backend.join('\n')}`)
  await context.close()
  return expected.length
}

// Bootstrap válido mas NENHUM snapshot da Home gravado: o app abre, e onde não há dado real aparece "—".
async function coldStartWithoutSnapshot(browser, origin, outDir) {
  const { context, page: first } = await installOnline(browser, origin, outDir)
  await seed(first, { snapshot: false })
  await seedSupabaseSession(first)
  await first.close()
  await context.setOffline(true)
  const page = await context.newPage()
  await watchOfflineFlash(page)
  await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' })
  await waitForDashboard(page)
  deepStrictEqual(await headerBalances(page), ['—', '—'], 'sem snapshot o header deve mostrar "—", nunca 0')
  deepStrictEqual(await homeStrip(page), { week: '—', volume: '—' })
  assert((await page.getByText('Disponível quando houver conexão', { exact: false }).count()) === 1)
  assert((await page.getByText('0 dias de consistência', { exact: false }).count()) === 0)
  const flash = await page.evaluate(() => window.__flash)
  assert(!flash.blockText && !flash.inert, 'flash de "sem conexão" no cold start sem snapshot')
  await context.close()
}

// Token VENCIDO + sem rede: o app NÃO espera o auth-js (que insiste em renovar por ~25 s): abre em segundos do
// snapshot local, com a Home preenchida, e continua aberto quando a sessão inicial vazia chega depois.
async function coldStartWithExpiredToken(browser, origin, outDir) {
  const { context, page: first } = await installOnline(browser, origin, outDir)
  await seed(first, { snapshot: true })
  await seedSupabaseSession(first, { expired: true })
  await first.close()
  await context.setOffline(true)
  const page = await context.newPage()
  await watchOfflineFlash(page)
  const started = Date.now()
  await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' })
  await waitForDashboard(page)
  const elapsed = Date.now() - started
  assert(elapsed < 8000, `Cold start com token vencido demorou ${elapsed} ms (esperou o auth-js?)`)
  deepStrictEqual(await headerBalances(page), ['20', '320'])
  const flash = await page.evaluate(() => window.__flash)
  assert(!flash.blockText && !flash.inert, 'flash de "sem conexão" com token vencido')
  // A sessão inicial vazia do auth-js chega depois do retry: o app aberto NÃO pode ser derrubado por ela.
  await page.waitForTimeout(32_000)
  await page.getByText('Modo offline: você entrou com os dados salvos neste aparelho.', { exact: false }).waitFor({ timeout: 2000 })
  deepStrictEqual(await headerBalances(page), ['20', '320'])
  assert(new URL(page.url()).pathname === '/app', 'o app saiu da Home depois da sessão inicial vazia')
  await context.close()
}

// Sem bootstrap (primeiro acesso offline): DEPOIS da restauração local o bloqueio aparece, como sempre.
async function coldStartWithoutBootstrap(browser, origin, outDir) {
  const { context, page: first } = await installOnline(browser, origin, outDir)
  await first.close()
  await context.setOffline(true)
  const page = await context.newPage()
  await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Você está sem conexão', { exact: false }).waitFor({ timeout: 15_000 })
  await page.waitForFunction(() => document.getElementById('app-content')?.inert === true, null, { timeout: 5000 })
  await context.close()
}

async function main() {
  assert(LEGAL_DIGEST, 'Bundle legal aprovado ausente no fixture')
  const outDir = mkdtempSync(join(tmpdir(), 'evolutus-offline-browser-'))
  let server
  let browser
  try {
    buildCanary(outDir)
    const started = await startStaticServer(outDir)
    server = started.server
    const origin = started.origin
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined })
    const coreAssets = await coldStartWithoutManualWarmup(browser, origin, outDir)
    await coldStartWithoutSnapshot(browser, origin, outDir)
    await coldStartWithExpiredToken(browser, origin, outDir)
    await coldStartWithoutBootstrap(browser, origin, outDir)
    const context = await browser.newContext()
    let page = await context.newPage()
    await page.goto(`${origin}/app`)
    await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not activate within 30 seconds')), 30000)),
  ]))
    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload()
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    const assets = readdirSync(join(outDir, 'assets')).filter((name) => /\.(js|css)$/.test(name))
    await page.evaluate(async (names) => Promise.all(names.map((name) => fetch(`/assets/${name}`))), assets)
    await seed(page)
    await page.close()

    await context.setOffline(true)
    page = await context.newPage()
    await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Modo offline: você entrou com os dados salvos neste aparelho.', { exact: false }).waitFor()
    await waitForDashboard(page)
    await page.getByText('1 alteração salva neste aparelho', { exact: false }).first().waitFor({ timeout: 15_000 })
    await page.locator('a[href="/novo-treino"]').first().click()
    await page.locator('.muscle-group-card').first().click()
    await page.locator('.workout-exercise-card').first().click()
    await page.getByLabel('Peso (kg)').fill('25')
    await page.getByLabel('Repetições').fill('10')
    await page.getByRole('button', { name: 'Concluir série' }).click()
    // Each completed set is already saved; the outbox is the assertion of success.
    await page.waitForFunction(async ({ dbName, dbVersion }) => new Promise((resolveDone) => {
      const open = indexedDB.open(dbName, dbVersion)
      open.onsuccess = () => {
        const db = open.result
        const count = db.transaction('outbox').objectStore('outbox').count()
        count.onsuccess = () => { db.close(); resolveDone(count.result >= 2) }
      }
    }), { dbName: DB_NAME, dbVersion: DB_VERSION })
    assert((await readLocal(page)).outbox.length >= 2, 'Treino offline não foi enfileirado')

    // Atualização REAL do SW em um diretório temporário: novo VERSION, mesma IndexedDB/outbox.
    await context.setOffline(false)
    const swPath = join(outDir, 'sw.js')
    const originalSw = readFileSync(swPath, 'utf8')
    writeFileSync(swPath, originalSw.replace(/const VERSION = '[^']+'/, "const VERSION = 'phase5-browser-update'"))
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      await Promise.all([
        new Promise((resolveChange) => navigator.serviceWorker.addEventListener('controllerchange', resolveChange, { once: true })),
        registration.update(),
      ])
    })
    const afterUpdate = await readLocal(page)
    assert(afterUpdate.bootstrap && afterUpdate.outbox.length >= 2, 'Upgrade do SW perdeu bootstrap/outbox')

    // Backend alcançável sem sessão: exige login online e preserva o trabalho pendente.
    await context.route('**/auth/v1/health', (route) => route.fulfill({ status: 200, body: 'ok' }))
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await page.waitForURL('**/login', { timeout: 15_000 })
    const afterReconnect = await readLocal(page)
    assert(afterReconnect.outbox.length >= 2, 'Reconexão sem sessão apagou a outbox')
    console.log(`CHROMIUM_OFFLINE_OK: cold start sem pré-busca manual (${coreAssets} assets do SW), sem flash de "sem conexão", Home restaurada do snapshot (saldo e atividade; "—" sem snapshot), sem RPC/Realtime no boot, IndexedDB, outbox=${afterReconnect.outbox.length}, escrita, reconexão e atualização do SW`)
  } finally {
    await browser?.close()
    if (server) {
      server.closeAllConnections()
      await new Promise((resolveClosed) => server.close(resolveClosed))
    }
    rmSync(outDir, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
