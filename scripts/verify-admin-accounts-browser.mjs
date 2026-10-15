// Local only: intercept all remote requests before loading the actual React app.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const origin = process.argv[2] || 'http://127.0.0.1:55447'
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/)
const mode = process.argv[3] || 'after'
const performanceOnly = process.argv[4] === 'performance'
const widths = performanceOnly ? [390] : [320, 360, 375, 390, 430, 768, 1024, 1366]
const dir = `docs/releases/admin-contas/${mode}`
await mkdir(dir, { recursive: true })
const manifest = JSON.parse(await readFile('legal/manifest.json', 'utf8'))
const documents = JSON.parse(await readFile('legal/documents.json', 'utf8'))
const digest = JSON.parse(await readFile('legal/approved-digests.json', 'utf8'))[manifest.version]
const uid = '71000000-0000-4000-8000-000000000001'
const user = {
  id: uid,
  email: 'admin@example.invalid',
  aud: 'authenticated',
  role: 'authenticated',
  email_confirmed_at: '2026-10-01T00:00:00Z',
  user_metadata: {},
  app_metadata: { provider: 'email', providers: ['email'] },
  created_at: '2026-10-01T00:00:00Z',
}
const profile = {
  id: uid,
  username: 'adminfixture',
  role: 'superadmin',
  account_status: 'active',
  legal_acceptance_version: manifest.version,
  legal_acceptance_digest: digest,
  legal_acceptance_accepted_at: '2026-10-01T00:00:00Z',
}
function snapshot(n) {
  const accounts = Array.from({ length: Math.min(n, 1000) }, (_, i) => ({
    id: `72000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    username: `membro${String(i + 1).padStart(4, '0')}`,
    email: `membro${i + 1}@example.invalid`,
    role: 'user',
    status: ['active', 'disabled', 'suspended', 'deleting'][i % 4],
    created_at: '2026-10-01T00:00:00Z',
    last_active_at: '2026-10-14T12:00:00Z',
    last_sign_in_at: null,
    community_count: i % 4,
    financial_status: 'none',
    flags_count: i % 3,
    showcase_status: 'none',
    deletion_status: i % 4 === 3 ? 'pending' : 'none',
    accepted_legal_version: manifest.version,
    restriction_action: i % 4 === 2 ? 'permanent_ban' : null,
  }))
  return {
    accounts,
    generated_at: '2026-10-14T12:00:00Z',
    metrics: {
      total_accounts: n,
      active_accounts: Math.ceil(n / 4),
      suspended_accounts: Math.floor(n / 4),
      new_accounts_7d: 0,
      pending_deletions: Math.floor(n / 4),
    },
    meta: { total: n, returned: accounts.length, truncated: n > 1000, max_snapshot_rows: 1000 },
  }
}
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const results = []
try {
  for (const width of widths)
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
        permissions: ['clipboard-read', 'clipboard-write'],
        reducedMotion: 'reduce',
      })
      const calls = []
      let fixture = snapshot(7)
      let richDetails = false
      const longText =
        'Texto sintético longo para verificar alinhamento, quebra de linha e legibilidade. '.repeat(
          5
        )
      const communityData = Array.from({ length: 12 }, (_, i) => ({
        id: `community-${i}`,
        name: `Comunidade ${i + 1} · ${'Nome longo '.repeat(5)}`,
        member_count: 1234,
        joined_at: '2026-10-01T00:00:00Z',
        is_owner: i === 0,
        is_active: i % 2 === 0,
      }))
      const auditData = Array.from({ length: 12 }, (_, i) => ({
        id: `audit-${i}`,
        action: 'account_disabled',
        reason: longText,
        metadata: {},
        created_at: '2026-10-14T12:00:00Z',
        admin_username: 'adminfixture',
      }))
      await context.route('**/*', async (route) => {
        const req = route.request(),
          url = new URL(req.url()),
          name = url.pathname.split('/').at(-1)
        if (url.origin === origin) return route.continue()
        if (!url.hostname.endsWith('.supabase.co')) return route.abort()
        let data = []
        if (url.pathname.includes('/rpc/admin_')) calls.push(name)
        if (name === 'admin_accounts_snapshot') data = fixture
        else if (name === 'admin_account_communities') data = richDetails ? communityData : []
        else if (name === 'admin_list_audit_log') data = richDetails ? auditData : []
        else if (name === 'admin_account_financial')
          data = richDetails
            ? {
                coin_balance: 12345,
                cash_balance: 1234,
                recent_purchases: Array.from({ length: 5 }, (_, i) => ({
                  id: `purchase-${i}`,
                  cash_amount: 100,
                  amount_centavos: 12990,
                  status: ['pending', 'credited', 'cancelled', 'held_in_case', 'pending'][i],
                  created_at: '2026-10-14T12:00:00Z',
                })),
                deletion: {
                  state: 'blocked_financial_review',
                  protocol: 'EXC-12345678901234567890',
                  financial_case_protocol: 'FIN-12345678901234567890',
                },
              }
            : { coin_balance: 0, cash_balance: 0, recent_purchases: [], deletion: null }
        else if (url.pathname.includes('/auth/v1/user')) data = user
        else if (name === 'ensure_user_profile') data = profile
        else if (name === 'has_app_access') data = true
        else if (name === 'legal_policy')
          data = [{ version: manifest.version, digest, published: true }]
        else if (name === 'legal_versions') data = [{ manifest, documents, digest }]
        else if (name === 'users') data = [profile]
        else if (name.includes('unread')) data = 0
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'Content-Range': '0-0/1',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Range',
          },
          body: JSON.stringify(data),
        })
      })
      await context.routeWebSocket('**/realtime/**', (socket) => socket.close())
      await context.addInitScript(
        ({ uid, user, dark }) => {
          const exp = Math.floor(Date.now() / 1000) + 3600
          const token =
            btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) +
            '.' +
            btoa(JSON.stringify({ sub: uid, role: 'authenticated', exp })) +
            '.fixture'
          localStorage.setItem(
            'sb-ywrjojrjgozdfpddkkuy-auth-token',
            JSON.stringify({
              access_token: token,
              refresh_token: 'fixture',
              expires_at: exp,
              expires_in: 3600,
              token_type: 'bearer',
              user,
            })
          )
          localStorage.setItem('colorMode', dark ? 'night' : 'day')
        },
        { uid, user, dark }
      )
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(origin + '/admin/contas')
      await page.getByRole('heading', { name: 'Contas', exact: true }).waitFor()
      assert.equal(calls.length, 0)
      await page.getByRole('button', { name: 'Atualizar dados', exact: true }).first().click()
      await page.getByRole('button', { name: '@membro0001', exact: true }).first().waitFor()
      const listStartY = (
        await page.getByRole('button', { name: '@membro0001', exact: true }).first().boundingBox()
      ).y
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      await page.screenshot({
        path: `${dir}/${width}-${dark ? 'dark' : 'light'}-list.png`,
        fullPage: true,
      })
      await page.getByRole('button', { name: '@membro0001', exact: true }).first().click()
      await page.getByRole('button', { name: 'Fechar painel' }).waitFor()
      await page.screenshot({
        path: `${dir}/${width}-${dark ? 'dark' : 'light'}-drawer.png`,
        animations: 'disabled',
        fullPage: false,
      })
      if (mode === 'after') {
        assert.equal(overflow, false, `overflow ${width}`)
        const modal = page.getByRole('dialog', { name: /Detalhes/ })
        await modal.waitFor()
        assert.equal(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth), true)
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true
        )
        assert.equal(await modal.evaluate((el) => el.contains(document.activeElement)), true)
        const bounds = await modal.boundingBox()
        if (width < 768) {
          assert.equal(Math.round(bounds.width), width)
          assert.equal(Math.round(bounds.height), 900)
        }
        assert.equal(
          await modal.evaluate((el) => {
            const rect = el.getBoundingClientRect()
            return el.contains(document.elementFromPoint(rect.left + 20, rect.top + 20))
          }),
          true
        )
        await page.keyboard.press('Tab')
        assert.equal(await modal.evaluate((el) => el.contains(document.activeElement)), true)
        await page.getByRole('button', { name: 'Financeiro', exact: true }).click()
        await page.getByText('Últimas compras de EvoCash').waitFor()
        await page.getByRole('button', { name: 'Visão geral', exact: true }).click()
        await page.getByRole('button', { name: 'Financeiro', exact: true }).click()
        assert.equal(calls.filter((x) => x === 'admin_account_financial').length, 1)
        for (const [label, text, rpc] of [
          ['Comunidades', 'Nenhuma comunidade.', 'admin_account_communities'],
          ['Auditoria', 'Nenhum registro de auditoria.', 'admin_list_audit_log'],
        ]) {
          await page.getByRole('button', { name: label, exact: true }).click()
          await page.getByText(text, { exact: true }).waitFor()
          await page.screenshot({
            path: `${dir}/${width}-${dark ? 'dark' : 'light'}-${label === 'Comunidades' ? 'communities' : 'audit'}-empty.png`,
            animations: 'disabled',
          })
          await page.getByRole('button', { name: 'Visão geral', exact: true }).click()
          await page.getByRole('button', { name: label, exact: true }).click()
          assert.equal(calls.filter((name) => name === rpc).length, 1)
        }
        await page.getByRole('button', { name: 'Financeiro', exact: true }).click()
        await page.screenshot({
          path: `${dir}/${width}-${dark ? 'dark' : 'light'}-financial-empty.png`,
          animations: 'disabled',
        })

        await page.keyboard.press('Escape')
        await modal.waitFor({ state: 'hidden' })
        await page
          .getByRole('textbox', { name: 'Buscar por @usuário, e-mail ou UID' })
          .fill('membro0002')
        await page
          .getByRole('button', { name: '@membro0001', exact: true })
          .waitFor({ state: 'hidden' })
        await page.getByRole('textbox', { name: 'Buscar por @usuário, e-mail ou UID' }).fill('')
        assert.equal(calls.filter((x) => x === 'admin_accounts_snapshot').length, 1)
      }
      if (mode === 'after' && !performanceOnly) {
        richDetails = true
        fixture = snapshot(7)
        fixture.accounts[0] = {
          ...fixture.accounts[0],
          username: 'conta_com_identificador_longo',
          email: `suporte.${'nome-muito-longo.'.repeat(6)}@example.invalid`,
          status: 'disabled',
          disabled_reason: longText,
          financial_status: 'pending',
          flags_count: 12,
          community_count: 12,
          restriction_action: 'temporary_suspension',
          restriction_until: '2026-11-01T12:00:00Z',
          accepted_legal_version: '2026.10.14.versao-com-identificador-extenso',
        }
        await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
        await page
          .getByRole('button', { name: '@conta_com_identificador_longo', exact: true })
          .first()
          .click()
        const detail = page.getByRole('dialog', { name: /Detalhes/ })
        await detail.waitFor()
        const initialHeaderTop = await detail
          .locator('.accounts-detail-header')
          .evaluate((el) => el.getBoundingClientRect().top)
        for (const [label, key] of [
          ['Visão geral', 'overview'],
          ['Comunidades', 'communities'],
          ['Financeiro', 'financial'],
          ['Auditoria', 'audit'],
        ]) {
          await detail.getByRole('button', { name: label, exact: true }).click()
          if (key === 'communities')
            await detail.getByText('Vínculos com comunidades', { exact: true }).waitFor()
          if (key === 'financial') await detail.getByText('12.345', { exact: true }).waitFor()
          if (key === 'audit')
            await detail.getByText('Conta desativada', { exact: true }).first().waitFor()
          assert.equal(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth), true)
          assert.equal(
            await detail.evaluate((el) =>
              [...el.querySelectorAll('*')].every(
                (child) =>
                  child.scrollWidth <= child.clientWidth ||
                  getComputedStyle(child).display === 'inline' ||
                  child.getAttribute('aria-hidden') === 'true' ||
                  child.tagName === 'SVG' ||
                  child.classList.contains('accounts-visually-hidden')
              )
            ),
            true,
            `internal overflow ${width} ${key}`
          )
          await page.screenshot({
            path: `${dir}/${width}-${dark ? 'dark' : 'light'}-${key}-long.png`,
            animations: 'disabled',
          })
          if (key === 'overview') {
            await detail.getByRole('button', { name: 'Copiar E-mail', exact: true }).click()
            await detail.getByText('Copiado', { exact: true }).first().waitFor()
            assert.equal(
              await page.evaluate(() => navigator.clipboard.readText()),
              fixture.accounts[0].email
            )
            await detail.getByRole('button', { name: 'Copiar UID', exact: true }).click()
            assert.equal(
              await page.evaluate(() => navigator.clipboard.readText()),
              fixture.accounts[0].id
            )
            await detail.locator('.accounts-detail-body').evaluate((el) => {
              el.parentElement.scrollTop = el.parentElement.scrollHeight
            })
            assert.equal(
              await detail
                .locator('.accounts-detail-header')
                .evaluate((el) => el.getBoundingClientRect().top),
              initialHeaderTop
            )
            await page.screenshot({
              path: `${dir}/${width}-${dark ? 'dark' : 'light'}-overview-long-bottom.png`,
              animations: 'disabled',
            })
          }
          if (key === 'communities') {
            const prior = calls.length
            await detail.getByRole('button', { name: 'Mostrar mais comunidades' }).click()
            assert.equal(calls.length, prior)
            await detail
              .getByText('Mostrando 12 de 12 vínculos carregados.', { exact: true })
              .waitFor()
          }
          if (key === 'audit') {
            const prior = calls.length
            await detail.getByRole('button', { name: 'Mostrar mais registros' }).click()
            assert.equal(calls.length, prior)
          }
        }
        await page.keyboard.press('Escape')
        await detail.waitFor({ state: 'hidden' })
        richDetails = false
        fixture = snapshot(7)
        await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
        await page.getByRole('button', { name: '@membro0001', exact: true }).first().waitFor()
      }
      if (mode === 'before') await page.getByRole('button', { name: 'Fechar painel' }).click()
      console.log(`checked ${width} ${dark}`)
      const cdp = await context.newCDPSession(page)
      await cdp.send('Performance.enable')
      const metrics = async () =>
        Object.fromEntries(
          (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])
        )
      const volumes = []
      if (width === 390 && !dark)
        for (const n of [7, 100, 1000, 1200]) {
          fixture = snapshot(n)
          console.log(`volume ${n}`)
          const prior = await metrics()
          const start = performance.now()
          await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
          await page
            .getByRole('button', { name: 'Atualizar', exact: true })
            .waitFor({ state: 'visible' })
          await page.waitForFunction(
            () => !document.querySelector('button[disabled] svg[aria-label="Loading"]')
          )
          const current = await metrics()
          volumes.push({
            heapBytes: current.JSHeapUsedSize,
            taskMs: Math.round((current.TaskDuration - prior.TaskDuration) * 1000),
            scriptMs: Math.round((current.ScriptDuration - prior.ScriptDuration) * 1000),
            layoutMs: Math.round((current.LayoutDuration - prior.LayoutDuration) * 1000),
            domNodes: current.Nodes,
            n,
            returned: fixture.accounts.length,
            payloadBytes: Buffer.byteLength(JSON.stringify(fixture)),
            refreshMs: Math.round(performance.now() - start),
          })
        }
      const uiChecks = []
      if (mode === 'after' && width === 390 && !dark) {
        const downloadReady = page.waitForEvent('download')
        const beforeMenu = calls.length
        await page.getByRole('button', { name: 'Opções da lista', exact: true }).click()
        assert.equal(calls.length, beforeMenu)
        await page.getByText('Exportar CSV', { exact: true }).last().click()
        const download = await downloadReady
        assert.match(download.suggestedFilename(), /^contas-evolutus-.*\.csv$/)
        const csv = await readFile(await download.path(), 'utf8')
        assert.equal(csv.charCodeAt(0), 0xfeff)
        assert.equal(csv.split('\r\n').length, 1002)
        await download.delete()
        uiChecks.push('CSV from secondary menu matches filtered snapshot')
        await page.getByRole('button', { name: 'Filtros', exact: true }).click()
        await page.getByRole('button', { name: 'Status', exact: true }).click()
        await page.getByText('Ativa', { exact: true }).last().click()
        await page.getByRole('button', { name: 'Papel', exact: true }).click()
        await page.getByText('Membro', { exact: true }).last().click()
        await page
          .getByRole('textbox', { name: 'Buscar por @usuário, e-mail ou UID' })
          .fill('membro0002')
        await page.getByText('Nenhuma conta encontrada', { exact: true }).waitFor()
        await page.screenshot({
          path: `${dir}/390-light-filters.png`,
          fullPage: false,
          animations: 'disabled',
        })
        await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
        await page
          .getByRole('checkbox', { name: 'Selecionar @membro0001 na lista móvel', exact: true })
          .check()
        await page.getByRole('region', { name: 'Ações em massa' }).waitFor()
        await page.getByRole('button', { name: 'Ordenar', exact: true }).click()
        await page.getByText('Usuário', { exact: true }).last().click()
        await page.getByRole('region', { name: 'Ações em massa' }).waitFor({ state: 'hidden' })
        await page.getByRole('checkbox', { name: 'Selecionar página na lista móvel' }).check()
        await page
          .getByRole('region', { name: 'Ações em massa' })
          .getByRole('button', { name: 'Desativar', exact: true })
          .click()
        const confirmation = page.getByRole('dialog', { name: /Desativar/ })
        await confirmation.waitFor()
        await confirmation
          .getByRole('textbox', { name: /Motivo/ })
          .fill('Teste sintético controlado')
        await confirmation.getByRole('button', { name: 'Desativar conta', exact: true }).click()
        await confirmation
          .getByText('Erro ao alterar o status. Tente novamente.', { exact: true })
          .waitFor()
        await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click()
        uiChecks.push(
          'combined filters + empty state',
          'selection cleared on sort',
          'bulk malformed response shows error'
        )
      }
      results.push({
        listStartY,
        uiChecks,
        width,
        theme: dark ? 'dark' : 'light',
        overflow,
        calls,
        volumes,
        errors,
      })
      assert.deepEqual(errors, [])
      await context.close()
    }
} finally {
  await browser.close()
}
await writeFile(
  `${dir}/${performanceOnly ? 'performance' : 'results'}.json`,
  JSON.stringify(results, null, 2)
)
console.log(JSON.stringify({ mode, captures: results.length * 2, results: results.length }))
