// Ponta a ponta real da recompensa por atividade: navegador real (Playwright) com o hook
// useQualifiedActivity de verdade, sessão real emitida pelo GoTrue (Auth real), chamadas de
// rede reais para o PostgREST real, RPC real no PostgreSQL real, crédito real no ledger/carteira,
// e o saldo relido do servidor depois do crédito e exibido no DOM. Nenhuma camada é simulada
// aqui -- segurança/concorrência continuam provadas pelo pgTAP (supabase/tests/*_test.sql) e
// pelos scripts de concorrência; este script prova que a CADEIA entre elas está de fato ligada.
//
// Requer a stack local real já no ar e migrada:
//   node scripts/homolog/finance/stack.mjs start
//   node scripts/homolog/finance/migrate.mjs all evolutus_integrated_db
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const runtime = root + '/.finance-local/runtime'
const config = JSON.parse(readFileSync(runtime + '/local.json', 'utf8'))
assert.equal(config.url, 'http://127.0.0.1:55454')
const DB_CONTAINER = 'evolutus_integrated_db'
const sql = (text) =>
  execFileSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', text],
    { encoding: 'utf8' }
  ).trim()

const admin = createClient(config.url, config.service, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

async function createRealUser() {
  const email = randomUUID() + '@example.invalid'
  const password = 'Local-e2e-activity-2026!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert.ifError(error)
  // admin.createUser() nunca passa pela RPC transacional de onboarding (20261223000002) nem
  // pelo backfill histórico da migration 01 (que só roda uma vez, sobre linhas já existentes
  // -- este usuário nasce depois). Sem o marcador, o hook de claims emitiria 'auth_setup' no
  // login abaixo (amr=password, mas onboarding incompleto) e has_app_access()/
  // register_qualified_activity recusariam com APP_ACCESS_DENIED -- correto para uma conta de
  // verdade ainda não onboarded, mas este teste não é sobre onboarding, é sobre a recompensa de
  // atividade. Mesma gravação que o backfill 'legacy' faz para contas pré-existentes.
  sql(`insert into private.auth_onboarding_completed(user_id, completed_at, source) values ('${data.user.id}', now(), 'legacy')`)
  const anon = createClient(config.url, config.anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const login = await anon.auth.signInWithPassword({ email, password })
  assert.ifError(login.error)
  return { id: data.user.id, session: login.data.session }
}

let directory, server, browser, failed = false, original = null
const pageErrors = []
try {
  const user = await createRealUser()
  // Confirma de verdade (não assume) que o Auth real emitiu session_id e que a sessão existe
  // em auth.sessions -- é exatamente esse par que has_app_access()/register_qualified_activity
  // passaram a exigir (20261114000001_financial_auth_integration.sql).
  const claims = JSON.parse(Buffer.from(user.session.access_token.split('.')[1], 'base64url'))
  assert.ok(claims.session_id, 'Auth real deve emitir session_id no JWT')
  assert.equal(sql(`select count(*)::int from auth.sessions where id='${claims.session_id}' and user_id='${user.id}'`), '1')

  // O intervalo mínimo entre checkpoints (60s) e o teto de 20 min por intervalo são constantes
  // no corpo de private.record_activity_checkpoint, não uma configuração -- não há como (nem
  // deve-se) acelerá-los sem editar a migration. O que É configuração, e só é afrouxado NESTE
  // banco descartável (restaurado no finally, nunca uma migration, nunca produção), é o limiar
  // de recompensa e o piso de checkpoints -- para provar a MESMA cadeia de produção sem exigir
  // 30 minutos reais de execução a cada PR.
  original = JSON.parse(
    sql(`select json_build_object('s', activity_reward_seconds, 'c', activity_reward_min_checkpoints) from public.economy_reward_settings where id`)
  )
  sql(`update public.economy_reward_settings set activity_reward_seconds = 60, activity_reward_min_checkpoints = 2 where id`)

  directory = await mkdtemp(join(tmpdir(), 'evocoins-e2e-'))
  await build({
    stdin: {
      contents: `
        import React, { useState } from 'react'
        import { createRoot } from 'react-dom/client'
        import { BrowserRouter } from 'react-router-dom'
        import { useQualifiedActivity } from './src/hooks/useQualifiedActivity.js'
        import { getWallet } from './src/services/economyService.js'

        function Harness() {
          useQualifiedActivity()
          const [balance, setBalance] = useState(null)
          window.__refreshBalance = async () => {
            const wallet = await getWallet(window.__uid, { forceRefresh: true })
            setBalance(wallet.coinBalance)
            return wallet.coinBalance
          }
          return React.createElement('div', { id: 'balance' }, balance === null ? 'loading' : String(balance))
        }
        createRoot(document.getElementById('root')).render(
          React.createElement(BrowserRouter, null, React.createElement(Harness))
        )
      `,
      resolveDir: root,
      loader: 'jsx',
    },
    outfile: join(directory, 'app.js'),
    bundle: true,
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'e2e-activity-boundaries',
        setup(b) {
          b.onResolve({ filter: /useAuth$/ }, () => ({ path: 'auth', namespace: 'stub' }))
          b.onResolve({ filter: /supabase\/config$/ }, () => ({ path: 'supabase-config', namespace: 'stub' }))
          b.onLoad({ filter: /^auth$/, namespace: 'stub' }, () => ({
            contents: `export const useAuth = () => ({ user: { id: window.__uid }, profile: { id: window.__uid }, offlineLocal: false })`,
          }))
          b.onLoad({ filter: /^supabase-config$/, namespace: 'stub' }, () => ({
            contents: `
              import { createClient } from '@supabase/supabase-js'
              export const supabase = createClient(window.__supabaseUrl, window.__supabaseAnonKey, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
              })
              // Sessão real emitida pelo Auth real (ver createRealUser acima) -- sem isto, o
              // cliente chamaria as RPCs como anon, e register_qualified_activity exige sessão.
              supabase.auth.setSession(window.__session)
            `,
            resolveDir: root,
          }))
        },
      },
    ],
  })

  server = createServer(async (req, res) => {
    const path = req.url.split('?')[0]
    if (path === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(await readFile(join(directory, 'app.js')))
      return
    }
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const pageUrl = `http://127.0.0.1:${server.address().port}`

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()) })

  await page.addInitScript(
    ({ url, anon, uid, accessToken, refreshToken }) => {
      window.__supabaseUrl = url
      window.__supabaseAnonKey = anon
      window.__uid = uid
      window.__session = { access_token: accessToken, refresh_token: refreshToken }
    },
    { url: config.url, anon: config.anon, uid: user.id, accessToken: user.session.access_token, refreshToken: user.session.refresh_token }
  )

  await page.goto(pageUrl)
  await page.locator('#balance').waitFor()
  await page.waitForTimeout(300) // tempo real para supabase.auth.setSession(window.__session) completar

  const coinBalance = () => sql(`select coalesce((select coin_balance from public.wallets where user_id='${user.id}'), 0)`)
  assert.equal(coinBalance(), '0', 'saldo real começa em zero antes de qualquer crédito (carteira ainda nem existe -- get_my_wallet devolve 0 sintético)')

  async function waitUntil(label, predicate, timeoutMs) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return
      await new Promise((r) => setTimeout(r, 5000))
    }
    throw new Error('timeout esperando: ' + label)
  }
  const checkpoints = () => Number(sql(`select checkpoints_count from public.community_creation_activity_days where user_id='${user.id}'`) || '0')

  // Nenhum relógio virtual aqui: o intervalo entre checkpoints é decidido pelo RELÓGIO REAL DO
  // SERVIDOR (now() em private.record_activity_checkpoint), não pelo relógio do navegador --
  // acelerar só o lado do cliente não mudaria o que o Postgres real vê chegar. useQualifiedActivity
  // não é instrumentado: o clique real e o setInterval real de 60s (TICK_INTERVAL_MS) é que
  // decidem quando a chamada de rede sai, exatamente como em produção.
  //
  // Ciclo 1: o PRIMEIRO ping do dia nunca soma segundos (ver record_activity_checkpoint) -- só
  // cria o checkpoint inicial. Isto prova que a tela única (zero navegação) já chega até o RPC.
  await page.mouse.click(5, 5) // interação real do navegador -- não um dispatchEvent sintético
  await waitUntil('1º checkpoint real (tela única, sem navegar)', () => checkpoints() >= 1, 120_000)

  // Ciclo 2: nova interação real; espera além do mínimo de 60s real entre checkpoints E dos
  // 3 min reais de MIN_PING_INTERVAL_MS do próprio hook (não acelerado), mas dentro dos 5 min
  // reais de IDLE_TIMEOUT_MS -- por isso o clique é repetido, não um único clique inicial.
  await page.waitForTimeout(100_000)
  await page.mouse.click(7, 7)
  await waitUntil('2º checkpoint real soma o intervalo e cruza o limiar reduzido', () => checkpoints() >= 2, 180_000)

  const balanceAfter = await page.evaluate(() => window.__refreshBalance())
  const domText = await page.locator('#balance').innerText()
  assert.equal(balanceAfter, 3, 'crédito real de 3 EvoCoins só por uso real de tela única (sem navegar, sem evento de negócio alheio)')
  assert.equal(domText, '3', 'o saldo relido do servidor real aparece na interface')

  const ledgerRows = sql(`select count(*)::int from public.economy_transactions where user_id='${user.id}' and reason='daily_activity'`)
  assert.equal(ledgerRows, '1', 'ledger real: exatamente um crédito de daily_activity')
  assert.equal(coinBalance(), '3', 'carteira real == 3')
  assert.ok(checkpoints() >= 2, 'piso de checkpoints reais (reduzido só neste banco descartável) atingido por uso de tela única')
  assert.equal(pageErrors.length, 0, 'sem erros no console/página: ' + pageErrors.join(' | '))

  console.log('PASS: atividade de tela única (navegador real) -> RPC real -> PostgreSQL real -> ledger -> carteira -> saldo relido e exibido na interface')
} catch (e) {
  failed = true
  console.error('FAIL', e)
  console.error('DEBUG pageErrors:', pageErrors)
  try {
    console.error('DEBUG checkpoints_count row:', execFileSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-c', 'select * from public.community_creation_activity_days order by updated_at desc limit 3'], { encoding: 'utf8' }))
    console.error('DEBUG now():', execFileSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-tAc', 'select now()'], { encoding: 'utf8' }))
  } catch { /* debug best-effort */ }
} finally {
  if (browser) await browser.close()
  if (server) await new Promise((r) => server.close(r))
  if (directory) await rm(directory, { recursive: true, force: true })
  if (original) sql(`update public.economy_reward_settings set activity_reward_seconds = ${original.s}, activity_reward_min_checkpoints = ${original.c} where id`)
}
process.exit(failed ? 1 : 0)
