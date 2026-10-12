// Chromium + builds reais + GoTrue/PostgREST/Storage locais. Sem destinos remotos.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { startAudGateway } from './homolog/aud-local-gateway.mjs'
const fixture = JSON.parse(readFileSync('/tmp/aud-homolog-sessions.json', 'utf8'))
const ROOT = process.cwd(),
  origin = 'http://127.0.0.1:55440'
let version = 'new',
  checks = 0
function ok(condition, label) {
  assert.ok(condition, label)
  checks++
  console.log(`PASS ${label}`)
}
function sql(source) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'evolutus_homolog_db',
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const gateway = await startAudGateway()
const server = createServer((req, res) => {
  const path = new URL(req.url, origin).pathname
  const dir = `/tmp/aud-homolog-dist-${version}`
  let file = resolve(dir, `.${path === '/' ? '/index.html' : path}`)
  if (!file.startsWith(dir + '/')) return res.writeHead(403).end()
  if (!existsSync(file)) {
    if (extname(path)) return res.writeHead(404).end()
    file = resolve(dir, 'index.html')
  }
  res.writeHead(200, {
    'Content-Type': mime[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(55440, '127.0.0.1', r))
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
})
async function context() {
  const c = await browser.newContext()
  c.setDefaultTimeout(20000)
  c.on('page', (page) => {
    page.on('pageerror', (error) =>
      console.log(`PAGE_ERROR ${error.name}: ${error.message.slice(0, 250)}`)
    )
    page.on('response', (response) => {
      if (response.status() >= 400)
        console.log(`HTTP_ERROR ${response.status()} ${new URL(response.url()).pathname}`)
    })
  })
  await c.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue()
    return route.abort('blockedbyclient')
  })
  return c
}
async function register(page, { name, email }) {
  await page.goto(`${origin}/cadastro`)
  await page.getByLabel('Nome de usuário').fill(name)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(fixture.password)
  await page.getByLabel('Data de nascimento').fill('1990-01-01')
  await page.getByLabel('Sexo').selectOption('nao_informar')
  await page.locator('input[name="usageProfile"][value="common"]').check()
  await page.locator('.legal-consent input[type="checkbox"]').first().waitFor()
  for (const box of await page.locator('.legal-consent input[type="checkbox"]').all())
    await box.check()
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click()
}
try {
  // Uma falha HTTP controlada entre RPCs reais; o retry retoma sem um segundo signUp.
  const suffix = randomUUID().replaceAll('-', '').slice(0, 7)
  const name = `retry_${suffix}`,
    email = `retry-${suffix}@example.invalid`
  const c = await context(),
    page = await c.newPage()
  let signups = 0,
    failBirth = true
  page.on('request', (req) => {
    if (req.url().endsWith('/auth/v1/signup')) signups++
  })
  await page.route('**/rest/v1/rpc/set_birth_info', async (route) => {
    if (failBirth) {
      failBirth = false
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'SIMULATED_INTERRUPTION',
          message: 'interrupção de homologação',
        }),
      })
    }
    return route.continue()
  })
  await register(page, { name, email })
  await page
    .getByText('Sua conta foi criada, mas o perfil não foi concluído.', { exact: false })
    .waitFor()
  ok(
    sql(`select count(*) from auth.users where email='${email}';`) === '1',
    'cadastro interrompido conserva uma identidade'
  )
  ok(
    sql(`select count(*) from public.usernames where username='${name}';`) === '1',
    'cadastro interrompido conserva reserva de nome'
  )
  ok(
    await page.getByLabel('E-mail').isDisabled(),
    'retry não troca o e-mail da identidade já criada'
  )
  await page.getByRole('button', { name: 'Concluir cadastro', exact: true }).click()
  await page.waitForURL(`${origin}/`, { timeout: 30000 })
  ok(signups === 1, 'retry em navegador não repete signUp')
  const completed = JSON.parse(
    sql(
      `select row_to_json(u) from public.users u join auth.users a on a.id=u.id where a.email='${email}';`
    )
  )
  ok(
    completed.username === name &&
      completed.data_nascimento === '1990-01-01' &&
      completed.legal_acceptance_version &&
      completed.usage_profile === 'common',
    'retry conclui nome/nascimento/aceite/perfil de uso'
  )
  await c.close()

  // Abandono da página: login real -> gate legal -> Meu Perfil, sem nova inscrição.
  const recoveryName = `recover_${suffix}`,
    recoveryEmail = `recover-${suffix}@example.invalid`
  const interrupted = await context(),
    p = await interrupted.newPage()
  let failName = true
  await p.route('**/rest/v1/rpc/set_username', async (route) => {
    if (failName) {
      failName = false
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'SIMULATED_INTERRUPTION',
          message: 'interrupção de homologação',
        }),
      })
    }
    return route.continue()
  })
  await register(p, { name: recoveryName, email: recoveryEmail })
  await p
    .getByText('Sua conta foi criada, mas o perfil não foi concluído.', { exact: false })
    .waitFor()
  await interrupted.close()
  const recovery = await context(),
    login = await recovery.newPage()
  let additionalSignups = 0
  login.on('request', (req) => {
    if (req.url().endsWith('/auth/v1/signup')) additionalSignups++
  })
  await login.goto(`${origin}/login`)
  await login.getByLabel('E-mail').fill(recoveryEmail)
  await login.getByLabel('Senha').fill(fixture.password)
  await login.getByRole('button', { name: 'Entrar', exact: true }).click()
  await login.getByLabel('Data de nascimento').waitFor({ timeout: 30000 })
  await login.getByLabel('Data de nascimento').fill('1990-01-01')
  for (const box of await login.locator('.legal-consent input[type="checkbox"]').all())
    await box.check()
  await login.getByRole('button', { name: 'Aceitar e continuar', exact: true }).click()
  await login
    .getByRole('button', { name: 'Aceitar e continuar', exact: true })
    .waitFor({ state: 'detached', timeout: 30000 })
  await login.goto(`${origin}/perfil`)
  await login.getByLabel('Nome de usuário').fill(recoveryName)
  await login.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await login.getByText('Perfil salvo com sucesso.', { exact: false }).waitFor({ timeout: 30000 })
  await login.locator('input[name="usageProfile"][value="professional"]').check()
  await login.getByRole('button', { name: 'Salvar perfil de uso', exact: true }).click()
  await login.getByText('Perfil de uso salvo.', { exact: false }).waitFor({ timeout: 30000 })
  const recovered = JSON.parse(
    sql(
      `select row_to_json(u) from public.users u join auth.users a on a.id=u.id where a.email='${recoveryEmail}';`
    )
  )
  ok(
    recovered.username === recoveryName &&
      recovered.data_nascimento === '1990-01-01' &&
      recovered.legal_acceptance_version &&
      recovered.usage_profile === 'professional',
    'login recupera conta e conclui perfil por telas reais'
  )
  ok(
    additionalSignups === 0 &&
      sql(`select count(*) from auth.users where email='${recoveryEmail}';`) === '1',
    'recuperação não cria outra identidade'
  )
  await recovery.close()

  // Cliente antigo em cache: o rollback legado recebe 403 e não apaga a conta.
  version = 'old'
  const legacyContext = await context(),
    legacyPage = await legacyContext.newPage()
  const legacyName = `legacy_${suffix}`,
    legacyEmail = `legacy-${suffix}@example.invalid`
  let legacyFailure = true
  await legacyPage.route('**/rest/v1/rpc/set_birth_info', async (route) => {
    if (legacyFailure) {
      legacyFailure = false
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'SIMULATED_INTERRUPTION',
          message: 'interrupção de homologação',
        }),
      })
    }
    return route.continue()
  })
  await register(legacyPage, { name: legacyName, email: legacyEmail })
  await legacyPage.getByText('Ocorreu um erro. Tente novamente.', { exact: false }).waitFor()
  ok(
    sql(`select count(*) from auth.users where email='${legacyEmail}';`) === '1' &&
      sql(`select count(*) from public.usernames where username='${legacyName}';`) === '1',
    'cadastro antigo interrompido: rollback legado negado sem perda de conta/reserva'
  )
  await legacyContext.close()
  version = 'new'
  // Executa o serviço de criação real antigo/novo, incluindo XMLHttpRequest e bytes de foto no Storage.
  await build({
    stdin: {
      contents: `import {createClient} from '@supabase/supabase-js'; window.__audClient=createClient(${JSON.stringify(fixture.API)},${JSON.stringify(fixture.anon)},{auth:{persistSession:false,autoRefreshToken:false}});`,
      resolveDir: ROOT,
    },
    outfile: '/tmp/aud-browser-bootstrap.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    logLevel: 'silent',
  })
  for (const v of ['old', 'new']) {
    const source =
      v === 'old'
        ? execFileSync('git', ['show', 'HEAD:src/services/statusesService.js'], {
            encoding: 'utf8',
          })
        : readFileSync('src/services/statusesService.js', 'utf8')
    await build({
      stdin: { contents: source, resolveDir: ROOT },
      outfile: `/tmp/aud-browser-service-${v}.js`,
      bundle: true,
      format: 'iife',
      globalName: `Status_${v}`,
      platform: 'browser',
      logLevel: 'silent',
      define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(fixture.API),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(fixture.anon),
      },
      plugins: [
        {
          name: 'local-client',
          setup(b) {
            b.onResolve({ filter: /supabase\/config$/ }, () => ({
              path: 'local',
              namespace: 'aud',
            }))
            b.onLoad({ filter: /.*/, namespace: 'aud' }, () => ({
              contents: 'export const supabase=window.__audClient',
            }))
          },
        },
      ],
    })
  }
  version = 'old'
  const stale = await context(),
    tab = await stale.newPage()
  await tab.goto(`${origin}/login`)
  await tab.getByLabel('E-mail').fill(fixture.users[0].email)
  await tab.getByLabel('Senha').fill(fixture.password)
  await tab.getByRole('button', { name: 'Entrar', exact: true }).click()
  await tab.waitForURL(`${origin}/`, { timeout: 30000 })
  await tab.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  const oldAssets = await tab.evaluate(() =>
    Array.from(document.scripts)
      .map((s) => s.src)
      .filter(Boolean)
  )
  await tab.addScriptTag({ path: '/tmp/aud-browser-bootstrap.js' })
  await tab.evaluate(async (session) => {
    const r = await window.__audClient.auth.setSession(session)
    if (r.error) throw Error(r.error.code)
  }, fixture.users[0].session)
  await tab.addScriptTag({ path: '/tmp/aud-browser-service-old.js' })
  async function publish(page, v) {
    const result = await page.evaluate(
      async ({ v, community, author }) => {
        const svc = window[`Status_${v}`]
        const receipts = []
        receipts.push(await svc.createTextStatus(community, author, `Texto ${v}`))
        receipts.push(await svc.createPollStatus(community, author, 'Pergunta?', ['Sim', 'Não']))
        receipts.push(
          await svc.createWorkoutStatus(community, author, {
            title: 'Treino',
            date: new Date(Date.now() + 86400000).toISOString(),
            location: 'Academia',
          })
        )
        const canvas = document.createElement('canvas')
        canvas.width = 4
        canvas.height = 4
        canvas.getContext('2d').fillRect(0, 0, 4, 4)
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp'))
        for (const progress of [
          null,
          { kind: 'week', periodStart: '2026-10-05', periodEnd: '2026-10-11' },
        ]) {
          const operation = await svc.createPhotoStatus(community, author, {
            blob,
            caption: 'Foto local',
            progress,
          })
          receipts.push(await operation.done)
        }
        const { data, error } = await window.__audClient
          .from('statuses')
          .select('*')
          .in(
            'id',
            receipts.map((r) => r.id)
          )
        if (error) throw Error(error.code)
        for (const row of data.filter((r) => r.type === 'photo')) {
          const { data: photo, error: storageError } = await window.__audClient.storage
            .from('status-photos')
            .download(row.photo_path.replace(/^statusPhotos\//, ''))
          if (storageError || !photo?.size) throw Error('Storage read failed')
        }
        return data.map((row) => ({
          type: row.type,
          name: row.author_username,
          badge: row.author_is_superadmin,
          promoted: row.promoted,
          progress: row.progress_kind,
          count: row.comment_count,
        }))
      },
      {
        v,
        community: fixture.community,
        author: { id: fixture.users[0].id, username: 'nome_falso', role: 'superadmin' },
      }
    )
    ok(
      result.length === 5 &&
        result.every((r) => r.name === 'aud_http_0' && !r.badge && !r.promoted && r.count === 0),
      `frontend ${v}/banco novo: cinco publicações, autoria real e sem promoção forjada`
    )
    ok(
      result.filter((r) => r.type === 'photo').length === 2 &&
        result.some((r) => r.progress === 'week'),
      `frontend ${v}/banco novo: foto e progresso com upload/download reais`
    )
  }
  await publish(tab, 'old')
  const oldShells = await tab.evaluate(async () =>
    (await caches.keys()).filter((k) => k.startsWith('treinos-shell-'))
  )
  version = 'new'
  await tab.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration.update()
  })
  await tab.waitForFunction(
    async (previous) =>
      (await caches.keys()).some((k) => k.startsWith('treinos-shell-') && !previous.includes(k)),
    oldShells,
    { timeout: 30000 }
  )
  ok(true, 'service worker atualiza shell e cache para o build novo')
  ok(
    JSON.stringify(
      await tab.evaluate(() =>
        Array.from(document.scripts)
          .map((s) => s.src)
          .filter(Boolean)
      )
    ) === JSON.stringify(oldAssets),
    'troca do SW preserva bundle antigo em aba aberta'
  )
  // O código antigo continua funcional após a troca do shell/cache.
  await publish(tab, 'old')
  // Rota lazy ainda não aberta: o hash antigo já não existe no servidor novo.
  await tab.evaluate((id) => {
    window.history.pushState({}, '', `/comunidades/${id}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, fixture.community)
  await tab
    .getByRole('heading', { name: 'Uma nova versão do app foi publicada', exact: true })
    .waitFor()
  ok(true, 'chunk antigo ausente mostra recuperação explícita, sem reload automático')
  await tab.getByRole('button', { name: 'Recarregar página', exact: true }).click()
  await tab.getByRole('heading', { name: 'AUD HTTP', exact: true }).waitFor({ timeout: 30000 })
  await tab.getByRole('button', { name: 'Publicar', exact: true }).click()
  const uiText = `publicação-ui-${suffix}`
  await tab.getByLabel('O que você quer compartilhar?').fill(uiText)
  const uiResponse = tab.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/rest/v1/statuses' &&
      response.request().method() === 'POST' &&
      response.status() === 201
  )
  await tab.getByRole('button', { name: 'Publicar', exact: true }).click()
  await uiResponse
  ok(
    sql(
      `select count(*) from public.statuses where text='${uiText}' and author_username='aud_http_0' and not promoted;`
    ) === '1',
    'rota e formulário reais publicam após recuperar chunk antigo'
  )
  await tab.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  const newAssets = await tab.evaluate(() =>
    Array.from(document.scripts)
      .map((s) => s.src)
      .filter(Boolean)
  )
  ok(oldAssets[0] !== newAssets[0], 'reload carrega bundle novo do frontend')
  await tab.addScriptTag({ path: '/tmp/aud-browser-bootstrap.js' })
  await tab.evaluate(async (session) => {
    const r = await window.__audClient.auth.setSession(session)
    if (r.error) throw Error(r.error.code)
  }, fixture.users[0].session)
  await tab.addScriptTag({ path: '/tmp/aud-browser-service-new.js' })
  await publish(tab, 'new')
  // Offline não pode publicar nem gravar objetos financeiros; o shell continua legível.
  await stale.setOffline(true)
  const offline = await tab.evaluate(
    async ({ community, fixtureUser }) => {
      try {
        await Status_new.createTextStatus(community, { id: fixtureUser }, 'offline-canary')
        return false
      } catch {
        return true
      }
    },
    { community: fixture.community, fixtureUser: fixture.users[0].id }
  )
  ok(
    offline && sql("select count(*) from public.statuses where text='offline-canary';") === '0',
    'offline não cria publicação por uma gravação cacheada'
  )
  const privateCached = await tab.evaluate(async (base) => {
    for (const key of await caches.keys()) {
      const cache = await caches.open(key)
      if ((await cache.keys()).some((request) => request.url.startsWith(base))) return true
    }
    return false
  }, fixture.API)
  ok(!privateCached, 'Cache Storage não armazena Auth, REST, RPC nem Storage privado')
  await stale.setOffline(false)
  await stale.close()
  console.log(`RESULT ${checks} verificações de navegador/PWA aprovadas.`)
} catch (error) {
  for (const c of browser.contexts())
    for (const p of c.pages())
      console.log(
        'PAGE_STATE',
        p.url(),
        (
          await p
            .locator('body')
            .innerText()
            .catch(() => '')
        ).slice(0, 600)
      )
  throw error
} finally {
  await browser.close()
  await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => gateway.close(r))])
}
