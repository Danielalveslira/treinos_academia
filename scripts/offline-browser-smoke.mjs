// Chromium real, dados sintéticos, sem credenciais nem chamadas a Supabase real.
// Usa playwright-core só em dev e compila um canário isolado em /tmp.
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
  const result = spawnSync('npm', ['run', 'build', '--', '--outDir', outDir], {
    cwd: ROOT, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`Build do canário falhou:\n${result.stderr || result.stdout}`)
}

async function startStaticServer(dir) {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const file = resolve(dir, `.${pathname === '/' ? '/index.html' : pathname}`)
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
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(body)
  })
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

async function seed(page) {
  await page.evaluate(({ dbName, dbVersion, userId, exerciseId, workoutId, mutationId, version, digest }) =>
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
        tx.objectStore('userExercises').put({ id: exerciseId, user_id: userId, name: 'Agachamento', muscle_group: 'quadriceps', type: 'strength', note: '', active: true, source: 'custom', order: 0 })
        tx.objectStore('workouts').put({ id: workoutId, user_id: userId, exercise_id: exerciseId, date: '2026-10-05', created_at: '2026-10-05T10:00:00Z', type: 'strength', set_details: [{ weight: 20, reps: 10 }], sets: 1, note: '' })
        tx.objectStore('outbox').put({ mutation_id: mutationId, user_id: userId, seq: 1, entity_type: 'workout', entity_id: workoutId, operation: 'workout.update', payload: { exercise_id: exerciseId, date: '2026-10-05', type: 'strength', set_details: [{ weight: 20, reps: 10 }], sets: 1, note: '' }, dates: ['2026-10-05'], base_updated_at: null, created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:00:00Z', attempts: 0, last_attempt_at: null, next_attempt_at: null, last_error: null, status: 'pending' })
        tx.oncomplete = () => { db.close(); resolveDone() }
        tx.onerror = () => reject(tx.error)
      }
    }), {
    dbName: DB_NAME, dbVersion: DB_VERSION, userId: USER_ID, exerciseId: EXERCISE_ID,
    workoutId: WORKOUT_ID, mutationId: MUTATION_ID, version: LEGAL_VERSION, digest: LEGAL_DIGEST,
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
async function seedSupabaseSession(page) {
  await page.evaluate(({ userId }) => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    localStorage.setItem('sb-offline-smoke-auth-token', JSON.stringify({
      access_token: 'a.b.c', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: expires,
      user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'offline@teste.dev', email_confirmed_at: '2026-10-01T10:00:00Z', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T10:00:00Z' },
    }))
  }, { userId: USER_ID })
}

// Reproduz o bug real: NADA é pré-buscado à mão. O Service Worker é a única fonte dos chunks; sessão do
// Supabase presente; PWA reaberto sem rede; Home -> Treino -> detalhe do exercício -> registro offline.
async function coldStartWithoutManualWarmup(browser, origin, outDir) {
  const context = await browser.newContext()
  let page = await context.newPage()
  await page.goto(origin)
  await page.evaluate(() => navigator.serviceWorker.ready)
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
  await seed(page)
  await seedSupabaseSession(page)
  await page.close()

  await context.setOffline(true)
  page = await context.newPage()
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

  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByText('Modo offline: você entrou com os dados salvos neste aparelho.', { exact: false }).waitFor({ timeout: 15_000 })
  assert((await page.getByText('Você está sem conexão', { exact: false }).count()) === 0, 'Tela de bloqueio offline apareceu')
  const blocked = await page.evaluate(() => document.getElementById('app-content')?.inert === true)
  assert(!blocked, 'Conteúdo do app ficou inerte (bloqueio offline do PwaControls)')
  await page.getByText('teste_offline', { exact: false }).first().waitFor({ timeout: 15_000 })

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
  await page.getByRole('button', { name: 'Finalizar exercício' }).click()
  await page.waitForFunction(async ({ dbName, dbVersion }) => new Promise((resolveDone) => {
    const open = indexedDB.open(dbName, dbVersion)
    open.onsuccess = () => {
      const db = open.result
      const count = db.transaction('outbox').objectStore('outbox').count()
      count.onsuccess = () => { db.close(); resolveDone(count.result >= 2) }
    }
  }), { dbName: DB_NAME, dbVersion: DB_VERSION })

  assert(problems.length === 0, `Falhas de chunk/asset offline:\n${problems.join('\n')}`)
  assert(backend.length === 0, `Boot offline tentou falar com o backend/Realtime:\n${backend.join('\n')}`)
  await context.close()
  return expected.length
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
    const context = await browser.newContext()
    let page = await context.newPage()
    await page.goto(origin)
    await page.evaluate(() => navigator.serviceWorker.ready)
    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload()
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    const assets = readdirSync(join(outDir, 'assets')).filter((name) => /\.(js|css)$/.test(name))
    await page.evaluate(async (names) => Promise.all(names.map((name) => fetch(`/assets/${name}`))), assets)
    await seed(page)
    await page.close()

    await context.setOffline(true)
    page = await context.newPage()
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.getByText('Modo offline: você entrou com os dados salvos neste aparelho.', { exact: false }).waitFor()
    await page.getByText('teste_offline', { exact: false }).first().waitFor({ timeout: 15_000 })
    await page.getByText('1 alteração salva neste aparelho', { exact: false }).first().waitFor({ timeout: 15_000 })
    await page.locator('a[href="/novo-treino"]').first().click()
    await page.locator('.muscle-group-card').first().click()
    await page.locator('.workout-exercise-card').first().click()
    await page.getByLabel('Peso (kg)').fill('25')
    await page.getByLabel('Repetições').fill('10')
    await page.getByRole('button', { name: 'Concluir série' }).click()
    await page.getByRole('button', { name: 'Finalizar exercício' }).click()
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
    console.log(`CHROMIUM_OFFLINE_OK: cold start sem pré-busca manual (${coreAssets} assets do SW), sem RPC/Realtime no boot, IndexedDB, outbox=${afterReconnect.outbox.length}, escrita, reconexão e atualização do SW`)
  } finally {
    await browser?.close()
    if (server) await new Promise((resolveClosed) => server.close(resolveClosed))
    rmSync(outDir, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
