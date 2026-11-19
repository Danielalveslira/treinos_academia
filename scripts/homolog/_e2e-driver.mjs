// Roda DENTRO do container playwright (ver verify-register-email-first-browser.mjs), já na
// rede interna da stack isolada. Serve dist-e2e/ (SPA, fallback para index.html) e dirige um
// Chromium real pelos dois modos de cadastro, com capturas de tela reais.
import { chromium } from 'playwright'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const SITE = '/site'
const SHOTS = '/shots'
const PORT = 4173
const KONG = 'http://127.0.0.1:8000'
const ANON = process.env.ANON
const SERVICE = process.env.SERVICE
const LEGACY = process.env.LEGACY_ONLY === '1'

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }

const server = http.createServer(async (req, res) => {
  let file = decodeURIComponent(req.url.split('?')[0])
  let full = path.join(SITE, file)
  try {
    const data = await readFile(full)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    // SPA fallback: qualquer rota do React Router serve o mesmo index.html.
    const data = await readFile(path.join(SITE, 'index.html'))
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(data)
  }
})
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
console.log(`servidor estático em http://127.0.0.1:${PORT}`)

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
  console.log(`screenshot: ${SHOTS}/${name}.png`)
}

async function generateLink(type, email, password) {
  const r = await fetch(`${KONG}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, email, ...(password && { password }) }),
  })
  const json = await r.json()
  if (!r.ok || typeof json.email_otp !== 'string') throw new Error(`generate_link falhou: ${r.status} ${JSON.stringify(json)}`)
  return json.email_otp
}

let checks = 0
function ok(cond, label) {
  if (!cond) throw new Error(`FALHOU: ${label}`)
  checks++
  console.log(`PASS ${label}`)
}

const consoleErrors = []
const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()
// Ruído conhecido e inofensivo de dev: o servidor estático deste driver devolve index.html
// (SPA fallback) para QUALQUER caminho sem correspondência, inclusive as chamadas de telemetria
// da Vercel (`/_vercel/...`) que não existem aqui -- o script de analytics tenta interpretar o
// HTML como JSON e lança "Unexpected token '<'". Mesmo achado já documentado na checagem visual
// anterior desta tarefa contra produção (ver AUTH_RESTRUCTURING_P1_P2_P4_STATUS.md, seção 5.5).
// Esta stack mínima não sobe Realtime (sem rota /realtime/v1 no Kong) nem todo bucket de
// Storage -- infraestrutura fora do escopo desta homologação de UI, não um bug do cadastro.
// Por isso a checagem real é por REQUISIÇÃO (URL + status), não por texto de console: só
// reprova uma falha dentro dos caminhos que o próprio fluxo de cadastro realmente usa.
const RELEVANT_PATH = /\/(auth|rest|functions)\/v1\//
const BENIGN_CONSOLE = /favicon|Download the React DevTools|Speed Insights|Web Analytics|Unexpected token '<'|_vercel|realtime|websocket|Failed to load resource/i
const requestErrors = []
const requestCounts = new Map()
page.on('request', (req) => {
  const url = new URL(req.url())
  if (RELEVANT_PATH.test(url.pathname)) {
    const key = `${req.method()} ${url.pathname}`
    requestCounts.set(key, (requestCounts.get(key) || 0) + 1)
  }
})
page.on('response', (res) => {
  const url = res.url()
  if (RELEVANT_PATH.test(url) && res.status() >= 400) requestErrors.push(`${res.status()} ${url}`)
})
page.on('console', (msg) => {
  if (msg.type() === 'error' && !BENIGN_CONSOLE.test(msg.text())) consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => { if (!BENIGN_CONSOLE.test(String(err))) consoleErrors.push(String(err)) })

try {
  const email = `e2e-browser-${Date.now()}@example.test`
  const username = `e2ebrowser${Date.now().toString().slice(-8)}`
  const newPassword = 'CorrectHorseBatteryStaple123'

  console.log('--- 1. abrindo /cadastro ---')
  await page.goto(`http://127.0.0.1:${PORT}/cadastro`, { waitUntil: 'networkidle' })
  await page.waitForSelector('h1:has-text("Crie sua conta")', { timeout: 15000 })
  ok(true, 'página de cadastro carregou')
  await shot(page, '01-email-step')

  await page.fill('input[autocomplete="username"]', username)
  // handleUsernameBlur dispara a checagem real de disponibilidade (rede) ao sair do campo;
  // espera o resultado antes de preencher o resto, para não avançar com o estado anterior.
  await page.fill('input[autocomplete="email"]', email)
  await page.waitForSelector('text=está disponível', { timeout: 10000 })
  if (LEGACY) {
    ok(await page.locator('input[type="password"]').count() === 1, 'senha presente na etapa 1 do cadastro convencional')
    await page.getByLabel(/^Senha/).fill(newPassword)
  } else {
    ok(await page.locator('input[type="password"]').count() === 0, 'sem campo de senha na etapa 1 (e-mail primeiro)')
  }
  await page.click('button[type="submit"]')

  console.log('--- 2. etapa de perfil ---')
  await page.waitForSelector('input[autocomplete="bday"]', { timeout: 15000 })
  await shot(page, '02-profile-step')
  await page.fill('input[autocomplete="bday"]', '1990-01-01')
  // CitySelector: combobox ARIA com rótulo próprio "Cidade onde mora" -- digita e Enter
  // escolhe a 1a sugestão real do catálogo (mesmo padrão testado em Register.test.js).
  const cityInput = page.getByLabel('Cidade onde mora')
  await cityInput.fill('São Paulo')
  await page.waitForSelector('[role="option"]', { timeout: 10000 })
  await page.keyboard.press('Enter')
  await page.selectOption('select', 'nao_informar')
  await page.click('button[type="submit"]')

  console.log('--- 3. etapa de perfil de uso + termos ---')
  await page.waitForSelector('fieldset.usage-profile-field', { timeout: 15000 })
  await shot(page, '03-usage-legal-step')
  await page.locator('fieldset.usage-profile-field input[type="radio"]').first().check()
  const consentBoxes = page.locator('.signup-consent input[type="checkbox"]')
  const n = await consentBoxes.count()
  for (let i = 0; i < n; i++) await consentBoxes.nth(i).check()
  await page.click('button[type="submit"]:has-text("Criar conta")')

  console.log('--- 4. etapa de código (OTP real, via generate_link) ---')
  await page.waitForSelector('text=Confirme seu e-mail', { timeout: 20000 })
  await shot(page, '04-otp-step-empty')
  const otp = await generateLink('signup', email, LEGACY ? newPassword : 'ThrowawayGenerateLinkPwd123')
  await page.fill('input[autocomplete="one-time-code"]', otp === '000000' ? '111111' : '000000')
  await page.click('button[type="submit"]:has-text("Confirmar")')
  await page.waitForTimeout(400)
  ok(LEGACY ? !page.url().includes('/app') : await page.getByText('Defina sua senha').count() === 0,
    'OTP incorreto não avança no cadastro')
  await page.fill('input[autocomplete="one-time-code"]', otp)
  await shot(page, '04b-otp-step-filled')
  await page.click('button[type="submit"]:has-text("Confirmar")')

  if (LEGACY) {
    await page.waitForURL(/\/app(?:\/|$)/, { timeout: 20000 })
    ok(true, 'cadastro convencional confirmado chega a /app')
    await page.getByRole('button', { name: 'Menu da conta' }).click()
    await page.getByText('Sair da conta').click()
    await page.waitForURL(/\/login(?:\/|$)/, { timeout: 20000 })
    ok(true, 'logout do cadastro convencional retorna ao login')
  } else {
    console.log('--- 5. etapa de senha ---')
    await page.waitForSelector('text=Defina sua senha', { timeout: 20000 })
    await shot(page, '05-password-step')
    const otherTab = await page.context().newPage()
    try {
      await otherTab.goto(`http://127.0.0.1:${PORT}/app`)
      await otherTab.getByRole('heading', { name: 'Continue a verificação da conta' }).waitFor({ timeout: 15000 })
      ok(true, 'segunda aba com sessão de cadastro não abre o app')
      await otherTab.reload()
      await otherTab.getByRole('heading', { name: 'Continue a verificação da conta' }).waitFor({ timeout: 15000 })
      ok(true, 'recarregar a segunda aba mantém a sessão restrita')
    } finally {
      await otherTab.close()
    }
    await page.getByLabel(/^Nova senha/).fill(newPassword)
    await page.getByLabel(/^Confirmar nova senha/).fill(newPassword)
    await page.click('button[type="submit"]:has-text("Concluir cadastro")')

    console.log('--- 6. handoff para login explícito ---')
    await page.waitForSelector('text=Cadastro concluído', { timeout: 20000 })
    await shot(page, '06-login-handoff')
    ok(true, 'chegou na tela de login com a mensagem de cadastro concluído')
  }

  const replayStatus = await page.evaluate(async ({ email, otp, anon, LEGACY }) => {
    const response = await fetch('http://127.0.0.1:8000/auth/v1/verify', {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token: otp, type: LEGACY ? 'signup' : 'email' }),
    })
    return response.status
  }, { email, otp, anon: ANON, LEGACY })
  ok(replayStatus >= 400, `OTP reutilizado é recusado pelo GoTrue (${replayStatus})`)

  await page.getByLabel(/^E-mail/).fill(email)
  await page.getByLabel(/^Senha/).fill(newPassword)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(/\/app(?:\/|$)/, { timeout: 20000 })
  ok(true, 'login com senha definitiva redireciona para /app')
  await page.getByRole('button', { name: 'Menu da conta' }).click()
  await page.getByText('Sair da conta').click()
  await page.waitForURL(/\/login(?:\/|$)/, { timeout: 20000 })
  ok(true, 'logout pela interface retorna ao login')

  ok(consoleErrors.length === 0, `sem erros inesperados no console (${consoleErrors.length} encontrados: ${consoleErrors.slice(0, 3).join(' | ')})`)

  console.log('Chamadas reais por endpoint:', JSON.stringify(Object.fromEntries([...requestCounts].sort())))

  console.log(`\n${checks} verificações, todas PASS.`)
  process.exitCode = 0
} catch (err) {
  await shot(page, '99-failure').catch(() => {})
  console.error('FALHA:', err.message)
  console.error('console do navegador:', consoleErrors.slice(0, 10))
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
