// Local component integration: real Chromium/React, simulated Push APIs and Supabase. No external I/O.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
const dir = await mkdtemp(join(tmpdir(), 'push-home-browser-'))
await build({
  stdin: {
    contents: `
      import React, { useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { MemoryRouter } from 'react-router-dom'
      import { ThemeProvider, BaseStyles } from '@primer/react'
      import '@primer/primitives/dist/css/functional/themes/light.css'
      import '@primer/primitives/dist/css/functional/themes/dark.css'
      import './src/styles/app.css'
      import { resolveLegalGateState } from './src/utils/legal.js'
      import { ThemeSync } from './src/components/ThemeSync.jsx'
      import { PushActivationNotice } from './src/features/notifications/components/PushActivationNotice.jsx'
      import { PushNotificationSettings } from './src/features/notifications/components/PushNotificationSettings.jsx'
      import { usePushSubscriptionSync } from './src/features/notifications/hooks/usePushSubscriptionSync.js'
      import { invalidatePushOperations } from './src/features/notifications/services/pushService.js'
      function App() {
        const [route, setRoute] = useState('home')
        const [tick, setTick] = useState(0)
        const id = window.fixture.auth.user?.uid
        window.fixture.render = () => setTick(v => v + 1)
        window.fixture.navigate = setRoute
        window.fixture.invalidate = invalidatePushOperations
        const auth = window.fixture.auth
        const allowed = Boolean(id) && !auth.offlineLocal && auth.serverAccessAllowed && !auth.deletionStatus && auth.profile?.accountStatus === 'active' && resolveLegalGateState({profile:auth.profile,access:auth.legalAccess,loading:false,error:''}) === 'allowed'
        usePushSubscriptionSync(allowed, id)
        return <ThemeProvider colorMode={window.fixture.dark ? 'night' : 'day'} dayScheme="light" nightScheme="dark"><BaseStyles><ThemeSync/><MemoryRouter>
          <main className="main-content" data-tick={tick} style={{maxWidth: 900, margin: 'auto', padding: 12}}>
            <h1>Olá, vamos treinar?</h1>
            {route === 'home' ? <><PushActivationNotice key={id} userId={id}/><div id="workout" style={{height:200}}>Iniciar treino</div></> : <PushNotificationSettings key={id} userId={id}/>}
          </main>
        </MemoryRouter></BaseStyles></ThemeProvider>
      }
      createRoot(document.getElementById('root')).render(<App/>)
    `,
    resolveDir: resolve('.'),
    loader: 'jsx',
  },
  outfile: join(dir, 'harness.js'),
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  define: {
    'import.meta.env.VITE_VAPID_PUBLIC_KEY': '"AQAB"',
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [
    {
      name: 'fixtures',
      setup(ctx) {
        ctx.onResolve({ filter: /hooks\/useAuth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
        ctx.onResolve({ filter: /supabase\/config$/ }, () => ({
          path: 'supabase',
          namespace: 'fixture',
        }))
        ctx.onLoad({ filter: /auth/, namespace: 'fixture' }, () => ({
          contents: 'export const useAuth = () => window.fixture.auth',
        }))
        ctx.onLoad({ filter: /supabase/, namespace: 'fixture' }, () => ({
          contents: `export const supabase = {
      auth: { getSession: async () => ({data: {session: {user: {id: window.fixture.auth.user.uid}}}}), onAuthStateChange: (fn) => {window.fixture.authChange = fn} },
      rpc: async (name, args) => {
        const f = window.fixture; f.calls.push(name)
        if (f.delay && name === 'get_my_push_status') await new Promise(r => setTimeout(r, f.delay))
        if (f.fail) return {error: new Error('Network unavailable')}
        if (name === 'activate_push_subscription') { f.registered = true; f.enabled = true; f.welcomes++; return {data:{welcome:f.welcome || 'queued'},error:null} }
        if (name === 'register_push_subscription') f.registered = true
        if (name === 'unregister_push_subscription') f.registered = false
        return {data: name === 'get_my_push_status' ? {enabled: f.enabled, thisDevice: f.registered && Boolean(args.p_endpoint), activeSubscriptions: f.other ? 1 : Number(f.registered)} : 'id', error: null}
      }
    }`,
        }))
      },
    },
  ],
  logLevel: 'silent',
})
const html =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/harness.css"><div id="root"></div><script type="module" src="/harness.js"></script>'
const server = createServer(async (req, res) => {
  if (!['/', '/harness.js', '/harness.css'].includes(req.url)) {
    res.writeHead(404).end()
    return
  }
  res.setHeader(
    'content-type',
    req.url.endsWith('.js')
      ? 'text/javascript'
      : req.url.endsWith('.css')
        ? 'text/css'
        : 'text/html'
  )
  res.end(req.url === '/' ? html : await readFile(join(dir, req.url.slice(1))))
}).listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const results = []
async function pageFor(options = {}) {
  const context = await browser.newContext({
    viewport: { width: options.width || 390, height: 900 },
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript((options) => {
    const f = (window.fixture = {
      calls: [],
      prompts: 0,
      unsubscribes: 0,
      subscriptions: 0,
      welcomes: 0,
      registered: false,
      enabled: true,
      permission: 'default',
      dark: false,
      ...options,
      auth: {
        user: { uid: 'test-user-a' },
        profile: { accountStatus: 'active', role: 'superadmin' },
        legalAccess: {},
        serverAccessAllowed: true,
        offlineLocal: false,
        ...(options.auth || {}),
      },
    })
    let subscription = f.local ? makeSubscription() : null
    function makeSubscription() {
      return {
        endpoint: 'https://fcm.googleapis.com/fcm/send/local-fixture',
        toJSON: () => ({
          endpoint: 'https://fcm.googleapis.com/fcm/send/local-fixture',
          keys: { p256dh: 'p'.repeat(32), auth: 'a'.repeat(16) },
        }),
        unsubscribe: async () => {
          f.unsubscribes++
          subscription = null
          return true
        },
      }
    }
    const registration = {
      pushManager: {
        getSubscription: async () => subscription,
        subscribe: async () => {
          f.subscriptions++
          subscription = makeSubscription()
          return subscription
        },
      },
    }
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: async () => registration, ready: Promise.resolve(registration) },
    })
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function () {} })
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        get permission() {
          return f.permission
        },
        requestPermission: () => {
          f.prompts++
          f.gesture = navigator.userActivation.isActive
          f.permission = f.permissionResult || 'granted'
          if (f.permissionVisibilityChange) document.dispatchEvent(new Event('visibilitychange'))
          return Promise.resolve(f.permission)
        },
      },
    })
    if (f.unsupported) delete window.PushManager
    if (f.ios) {
      Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Safari' })
      delete window.PushManager
    }
    if (f.optedOut) localStorage.setItem('evolutus:push-optout:test-user-a', '1')
    f.cls = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) f.cls += entry.value
    }).observe({ type: 'layout-shift', buffered: true })
  }, options)
  await page.goto(origin)
  try {
    await page.locator('#workout').waitFor()
  } catch (error) {
    throw new Error(JSON.stringify({ options, errors, cause: error.message }))
  }
  return { page, errors }
}
try {
  for (const width of [320, 390, 430, 1366])
    for (const dark of [false, true]) {
      const { page, errors } = await pageFor({ width, dark })
      await page.getByRole('button', { name: 'Ativar', exact: true }).waitFor()
      const measures = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        calls: fixture.calls,
        prompts: fixture.prompts,
        cls: fixture.cls,
        height: document.querySelector('.push-activation-notice').getBoundingClientRect().height,
      }))
      assert.equal(measures.overflow, false)
      assert.ok(
        measures.height <= (width <= 430 ? 100 : 60),
        `Altura ${measures.height}px em ${width}px`
      )
      const colors = await page.locator('.push-notice-enable').evaluate((el) => ({
        bg: getComputedStyle(el).backgroundColor,
        color: getComputedStyle(el).color,
        border: getComputedStyle(el.closest('section')).borderWidth,
      }))
      assert.equal(colors.bg, 'rgba(0, 0, 0, 0)')
      assert.equal(colors.border, '1px')
      assert.deepEqual(measures.calls, [])
      assert.equal(measures.prompts, 0)
      assert.equal(measures.cls, 0)
      const close = page.getByRole('button', { name: 'Dispensar convite para notificações' })
      const box = await close.boundingBox()
      assert.ok(box.width >= 44 && box.height >= 44)
      await page.screenshot({ path: join(dir, `home-${width}-${dark ? 'dark' : 'light'}.png`) })
      await close.click()
      await page.reload()
      await page.locator('#workout').waitFor()
      assert.equal(await page.locator('.push-activation-notice').count(), 0)
      assert.deepEqual(
        await page.evaluate(() => [fixture.calls.length, fixture.prompts, fixture.unsubscribes]),
        [0, 0, 0]
      )
      assert.deepEqual(errors, [])
      results.push({ scenario: 'layout/default/dismiss/reload', width, dark, ...measures })
      await page.close()
    }
  {
    const { page, errors } = await pageFor()
    await page.getByRole('button', { name: 'Ativar', exact: true }).click()
    await page.locator('section.push-activation-notice').waitFor({ state: 'detached' })
    await page
      .getByText('Notificações ativadas! Teste de boas-vindas solicitado.', { exact: true })
      .waitFor()
    assert.deepEqual(
      await page.evaluate(() => ({
        prompts: fixture.prompts,
        gesture: fixture.gesture,
        subscriptions: fixture.subscriptions,
        calls: fixture.calls,
      })),
      {
        prompts: 1,
        gesture: true,
        subscriptions: 1,
        calls: ['activate_push_subscription', 'get_my_push_status'],
      }
    )
    await page.evaluate(() => fixture.navigate('profile'))
    await page.getByText('Ativo neste dispositivo', { exact: true }).waitFor()
    await page.evaluate(() => fixture.navigate('home'))
    await page.locator('#workout').waitFor()
    assert.equal(await page.locator('.push-activation-notice').count(), 0)
    await page.evaluate(() => fixture.navigate('profile'))
    await page.getByText('Ativo neste dispositivo', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Desativar neste dispositivo', exact: true }).click()
    await page.getByText('Notificações desativadas neste dispositivo.', { exact: true }).waitFor()
    await page.evaluate(() => fixture.navigate('home'))
    await page.locator('#workout').waitFor()
    assert.equal(await page.locator('.push-activation-notice').count(), 0)
    assert.deepEqual(errors, [])
    results.push({ scenario: 'click/gesture/profile/disable/home', result: 'pass' })
    await page.close()
  }
  {
    const { page } = await pageFor({
      permission: 'granted',
      local: true,
      registered: true,
      delay: 1200,
    })
    await page.getByRole('button', { name: 'Ativar', exact: true }).waitFor()
    const topBefore = await page
      .locator('#workout')
      .evaluate((el) => el.getBoundingClientRect().top)
    await page.getByText('Notificações ativas neste dispositivo.', { exact: true }).waitFor()
    const topAfter = await page.locator('#workout').evaluate((el) => el.getBoundingClientRect().top)
    const measured = await page.evaluate(() => ({ calls: fixture.calls, cls: fixture.cls }))
    assert.equal(topBefore, topAfter)
    assert.deepEqual(measured.calls, ['get_my_push_status'])
    assert.ok(measured.cls < 0.01, `CLS ${measured.cls}`)
    results.push({ scenario: 'granted/delayed-confirmation', topBefore, topAfter, ...measured })
    await page.close()
  }
  for (const options of [
    { permission: 'denied' },
    { unsupported: true },
    { optedOut: true, permission: 'granted' },
    { permission: 'granted', auth: { offlineLocal: true } },
    { permission: 'granted', auth: { serverAccessAllowed: false } },
    { permission: 'granted', auth: { profile: { accountStatus: 'disabled' } } },
    { permission: 'granted', auth: { profile: { accountStatus: 'active', role: 'user' } } },
    { permission: 'granted', auth: { user: null } },
  ]) {
    const { page } = await pageFor(options)
    assert.equal(await page.locator('.push-activation-notice').count(), 0)
    assert.deepEqual(await page.evaluate(() => [fixture.prompts, fixture.calls]), [0, []])
    results.push({ scenario: 'ineligible', options, result: 'pass' })
    await page.close()
  }
  {
    const { page } = await pageFor()
    await page.clock.install({ time: new Date('2026-10-15T02:59:00Z') })
    await page.getByRole('button', { name: 'Dispensar convite para notificações' }).click()
    await page.clock.fastForward(2 * 60 * 1000)
    assert.equal(await page.locator('.push-activation-notice').count(), 0)
    await page.clock.fastForward(12 * 60 * 60 * 1000)
    await page.getByRole('button', { name: 'Ativar', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => [fixture.prompts, fixture.calls]), [0, []])
    results.push({ scenario: 'open-home-midnight-plus-12h', result: 'pass' })
    await page.close()
  }
  {
    const { page } = await pageFor({ permission: 'granted', local: true, fail: true })
    await page
      .getByText('Não foi possível verificar. Tente ativar novamente.', {
        exact: true,
      })
      .waitFor()
    assert.equal(await page.getByRole('button', { name: 'Ativar', exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => fixture.prompts), 0)
    results.push({ scenario: 'status-error-safe', result: 'pass' })
    await page.close()
  }
  {
    const { page } = await pageFor({ fail: true })
    await page.getByRole('button', { name: 'Ativar', exact: true }).click()
    await page
      .getByText(
        'Não foi possível confirmar as notificações. Verifique sua conexão e tente novamente.',
        { exact: true }
      )
      .waitFor()
    assert.equal(
      await page
        .getByText('Notificações ativadas! Teste de boas-vindas solicitado.', { exact: true })
        .count(),
      0
    )
    assert.equal(await page.getByRole('button', { name: 'Ativar', exact: true }).count(), 1)
    results.push({ scenario: 'registration-error-no-false-success', result: 'pass' })
    await page.close()
  }
  {
    const { page } = await pageFor({ ios: true })
    await page
      .getByText(
        'No Safari, toque em Compartilhar → Adicionar à Tela de Início. Depois abra o app instalado.',
        { exact: true }
      )
      .waitFor()
    assert.equal(await page.getByRole('button', { name: 'Ativar', exact: true }).count(), 0)
    assert.deepEqual(await page.evaluate(() => [fixture.calls, fixture.prompts]), [[], 0])
    results.push({ scenario: 'ios-installation-guidance', result: 'pass' })
    await page.close()
  }
  {
    const { page } = await pageFor()
    await page.getByRole('button', { name: 'Ativar', exact: true }).waitFor()
    const other = await page.context().newPage()
    await other.goto(origin + '/blank')
    await other.evaluate(() => {
      const at = Date.now()
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(at)
      localStorage.setItem('evolutus:push-notice:web:test-user-a', JSON.stringify({ day, at }))
    })
    await page.locator('.push-activation-notice').waitFor({ state: 'detached' })
    await page.evaluate(() => {
      fixture.auth.user.uid = 'test-user-b'
      fixture.authChange('SIGNED_IN', { user: { id: 'test-user-b' } })
      fixture.render()
    })
    await page.getByRole('button', { name: 'Ativar', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => [fixture.calls, fixture.prompts]), [[], 0])
    results.push({ scenario: 'real-storage-event-and-account-isolation', result: 'pass' })
    await page.close()
  }
  for (const options of [
    { permission: 'granted', enabled: false },
    { permission: 'granted', enabled: false, local: true },
    { welcome: 'unavailable' },
    { permissionVisibilityChange: true, delay: 120 },
  ]) {
    const { page } = await pageFor(options)
    await page.getByRole('button', { name: 'Ativar', exact: true }).click()
    const message =
      options.welcome === 'unavailable'
        ? 'Notificações ativadas! Não foi possível solicitar o teste agora.'
        : 'Notificações ativadas! Teste de boas-vindas solicitado.'
    await page.getByText(message, { exact: true }).waitFor()
    assert.equal(await page.getByText('Ver no Perfil', { exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => fixture.welcomes), 1)
    assert.equal(
      await page.evaluate(() => fixture.prompts),
      options.permission === 'granted' ? 0 : 1
    )
    assert.equal(await page.locator('section.push-activation-notice').count(), 0)
    results.push({ scenario: 'direct-home-activation', options, result: 'pass' })
    await page.close()
  }
  {
    const { page } = await pageFor()
    await page.clock.install()
    await page.getByRole('button', { name: 'Ativar', exact: true }).click()
    await page
      .getByText('Notificações ativadas! Teste de boas-vindas solicitado.', { exact: true })
      .waitFor()
    await page.clock.fastForward(8100)
    assert.equal(await page.locator('.push-notice-success').count(), 0)
    assert.equal(await page.evaluate(() => fixture.welcomes), 1)
    results.push({ scenario: 'temporary-success-no-extra-welcome', result: 'pass' })
    await page.close()
  }
  {
    const { page } = await pageFor({ permissionResult: 'denied' })
    await page.getByRole('button', { name: 'Ativar', exact: true }).click()
    await page
      .getByText('Permissão bloqueada. Libere notificações nas configurações do navegador.', {
        exact: true,
      })
      .waitFor()
    assert.deepEqual(
      await page.evaluate(() => [fixture.prompts, fixture.calls, fixture.welcomes]),
      [1, [], 0]
    )
    assert.equal(await page.getByRole('button', { name: 'Ativar', exact: true }).count(), 0)
    results.push({ scenario: 'denied-after-click-contextual-feedback', result: 'pass' })
    await page.close()
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ artifacts: dir, checks: results.length, results }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
