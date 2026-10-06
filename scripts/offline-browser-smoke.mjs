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
    console.log(`CHROMIUM_OFFLINE_OK: cold start, IndexedDB, outbox=${afterReconnect.outbox.length}, escrita, reconexão e atualização do SW`)
  } finally {
    await browser?.close()
    if (server) await new Promise((resolveClosed) => server.close(resolveClosed))
    rmSync(outDir, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
