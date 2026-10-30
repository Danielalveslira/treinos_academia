// Browser UX harness with synthetic RPCs. SQL authorization is tested separately with pgTAP.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'ad-v2-browser-'))
const fixture = `
 const accounts=new URLSearchParams(location.search).has('empty')?[]:[{id:'A',name:'Empresa A',active:true},{id:'B',name:'Empresa B',active:true}]
 const campaigns=[{id:'campaign-A',title:'Campanha A',partner_name:'Marca A',deleted:false},{id:'removed-A',title:'Histórico A',partner_name:'Marca A',deleted:true}]
 const linked={A:[{id:'linked-A',title:'Campanha vinculada A',partner_name:'Marca A',deleted:false,expires_at:'2020-01-01'}],B:[]}
 const members={A:[{id:'already',username:'ja_autorizado',granted_at:'2026-10-01T12:00:00Z',revoked_at:null}],B:[]}
 const available=[{id:'available-1',title:'Campanha disponível 1',deleted:false},{id:'available-2',title:'Campanha histórica disponível',deleted:true}]
 const users=[{id:'reader',username:'leitor_existente'},{id:'already',username:'ja_autorizado'}]
 const metrics={visible_impressions:10,unique_viewers:5,clicks:20,unqualified_clicks:2,qualified_clicks:18,ctr_qualified:180,ctr_raw:200}
 window.__advertisers={accounts,linked,members,available,users}
 window.__calls=[];window.__pendingReads=[];window.__readCalls=[]
 const page=(rows,args)=>rows.slice(args.p_offset||0,(args.p_offset||0)+100).map(r=>({...r}))
 export async function readCatalog(name,args={}) {
  window.__readCalls.push(name)
  if(name==='list_advertiser_accounts') return [...accounts]
  if(name==='list_advertiser_campaigns') return campaigns.map(c=>({...c,id:c.id.replace(/A$/,args.p_account_id)}))
  if(args.p_kind==='users') return page(users.filter(u=>u.username.includes(args.p_search||'')),args)
  if(args.p_kind==='members') return page(members[args.p_account_id]||[],args)
  return page(args.p_account_id?linked[args.p_account_id]||[]:available,args)
 }
 export async function advertiserRpc(name,args={}) {
  window.__calls.push({name,args:{...args}})
  if(window.__failNext && (!window.__failNext.operation || window.__failNext.operation===args.p_operation)) {
   const failure=window.__failNext;window.__failNext=null;throw Object.assign(new Error(failure.message||'network failure'),{code:failure.code||'network'})
  }
  if(name==='list_advertiser_accounts'){if(new URLSearchParams(location.search).has('slow'))await new Promise(resolve=>window.__releaseAccounts=resolve);return page(accounts,args)}
  if(name==='admin_advertiser_directory') {
   const result=await readCatalog(name,args)
   if(window.__delayAccount && window.__delayAccount===args.p_account_id)await new Promise(resolve=>window.__pendingReads.push(resolve))
   return result
  }
  if(name==='admin_manage_advertiser') {
   if(window.__holdOperation===args.p_operation)await new Promise(resolve=>window.__releaseOperation=resolve)
   if(args.p_operation==='create') {accounts.push({id:'new',name:args.p_name,active:true});members.new=[];linked.new=[];return 'new'}
   if(args.p_operation==='grant') {const u=users.find(u=>u.id===args.p_subject_id);const rows=members[args.p_account_id]||[];members[args.p_account_id]=[...rows.filter(m=>m.id!==u.id),{...u,granted_at:'2026-10-24T12:00:00Z',revoked_at:null}]}
   if(args.p_operation==='revoke') members[args.p_account_id].find(u=>u.id===args.p_subject_id).revoked_at='2026-10-24T12:00:00Z'
   if(args.p_operation==='link') {const c=available.find(c=>c.id===args.p_subject_id);if(!c)throw new Error('CAMPAIGN_OWNER_IMMUTABLE');linked[args.p_account_id]=[...(linked[args.p_account_id]||[]),{...c,account_id:args.p_account_id}];available.splice(available.indexOf(c),1)}
   if(args.p_operation==='update') Object.assign(accounts.find(a=>a.id===args.p_account_id),{name:args.p_name,active:args.p_active})
   return args.p_account_id
  }
  if(window.__metricsRevoked || args.p_account_id==='forged') throw Object.assign(new Error('PERMISSION_DENIED'),{code:'42501'})
  const m=args.p_account_id==='B'?{...metrics,visible_impressions:700}:metrics
  return {account:{id:args.p_account_id,name:'Empresa '+args.p_account_id},generated_at:'2026-10-24T10:00:00Z',
   period:{from:'2026-10-01',to:'2026-10-24',days:24,today:'2026-10-24',timezone:'America/Sao_Paulo'},filters:{ad_id:args.p_ad_id,placement:args.p_placement},
   collection:{server_enabled:false,has_any_data:true,last_day:'2026-10-24'},has_data:true,summary:m,
   daily:[{day:'2026-10-24',...m}],by_campaign:[{ad_id:'campaign-'+args.p_account_id,title:'Campanha '+args.p_account_id,...m}],
   by_placement:[{placement:'home_banner',...m}],by_context:[],campaigns_total:1,contexts_total:0,campaigns_truncated:false,contexts_truncated:false}
 }
`
await build({
  stdin: {
    contents: `import '@primer/primitives/dist/css/functional/themes/light.css';import '@primer/primitives/dist/css/functional/themes/dark.css';import './src/styles/app.css';import './src/styles/navigation.css';import {ThemeSync} from './src/components/ThemeSync.jsx';import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{ThemeProvider,BaseStyles}from'@primer/react';import MyAds from './src/pages/MyAds.jsx';import AdvertiserAdmin from './src/features/adMetrics/components/AdvertiserAdmin.jsx';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<ThemeProvider colorMode={q.get('theme')==='dark'?'night':'day'} dayScheme='light' nightScheme='dark'><BaseStyles><ThemeSync/><div className="app-shell"><main className="main-content"><MemoryRouter initialEntries={['/meus-anuncios?accountId='+ (q.get('account')||'A')]}>{q.has('admin')?<AdvertiserAdmin/>:<MyAds/>}</MemoryRouter></main></div></BaseStyles></ThemeProvider>)`,
    resolveDir: root,
    loader: 'jsx',
  },
  bundle: true,
  format: 'esm',
  outfile: join(dir, 'app.js'),
  jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
  loader: { '.css': 'css' },
  plugins: [
    {
      name: 'synthetic-fixtures',
      setup(b) {
        b.onResolve({ filter: /advertisers\.api(?:\.js)?$/ }, () => ({
          path: 'rpc',
          namespace: 'fixture',
        }))
        b.onResolve({ filter: /\/hooks\/useAuth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
        b.onResolve({ filter: /\/supabase\/config(?:\.js)?$/ }, () => ({ path: 'backend', namespace: 'fixture' }))
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'rpc'
              ? fixture
              : args.path === 'backend'
                // This report-reader fixture must never issue commercial writes.
                ? `export const supabase={rpc:async(name)=>{throw new Error('UNEXPECTED_COMMERCIAL_RPC:'+name)}}`
                : `export const useAuth=()=>({user:{uid:'reader'},isSuperAdmin:false})`,
          loader: 'js',
        }))
      },
    },
  ],
  logLevel: 'silent',
})
const server = createServer(async (req, res) => {
  res.setHeader(
    'Content-Type',
    req.url === '/app.js' ? 'text/javascript' : req.url === '/app.css' ? 'text/css' : 'text/html'
  )
  res.end(
    ['/app.js', '/app.css'].includes(req.url)
      ? await readFile(join(dir, req.url.slice(1)))
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>'
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  })
  const results = []
  for (const width of [390, 1280])
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        permissions: ['clipboard-read', 'clipboard-write'],
        acceptDownloads: true,
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(origin + '/?theme=' + theme)
      // "Resultados" is a separate, lazily-mounted tab: AdMetricsTab and
      // list_advertiser_campaigns must never be requested on the default "Meus anúncios"
      // load, only once the advertiser explicitly opens it.
      await page.getByRole('button', { name: 'Resultados', exact: true }).waitFor()
      assert.deepEqual(
        await page.evaluate(() => window.__calls),
        [],
        'no metrics RPC before Resultados is opened'
      )
      assert.equal(
        await page.evaluate(() => window.__readCalls.includes('list_advertiser_campaigns')),
        false,
        'list_advertiser_campaigns must not be requested before Resultados is opened'
      )
      await page.getByRole('button', { name: 'Resultados', exact: true }).click()
      await page.getByText('Impressões visíveis', { exact: true }).first().waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.dataset.colorMode), theme)
      assert.ok(
        !(await page.locator('body').evaluate((e) => getComputedStyle(e).fontFamily)).includes(
          'Times'
        )
      )
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'no horizontal page overflow'
      )
      await page.getByRole('combobox', { name: 'Indicadores no gráfico' }).selectOption('clicks')
      await page.getByText('Série diária em tabela', { exact: true }).click()
      assert.equal(await page.getByRole('table').count(), 1)
      await page.screenshot({
        path: join(tmpdir(), `ad-v2-dashboard-${width}-${theme}.png`),
        fullPage: true,
      })
      for (const format of ['CSV', 'PDF']) {
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Exportar ' + format, exact: true }).click()
        const content = await readFile(await (await download).path())
        assert.ok(
          format === 'PDF'
            ? content.toString().startsWith('%PDF-1.4')
            : content.toString().includes('Empresa A')
        )
        assert.ok(!content.toString().includes('Empresa B'))
      }
      await page.getByRole('button', { name: 'Compartilhar', exact: true }).click()
      await page.getByText('Link copiado.', { exact: false }).waitFor()
      assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes('accountId=A'))
      await page
        .getByRole('combobox', { name: 'Conta de anunciante', exact: true })
        .selectOption('B')
      await page.getByText('700', { exact: true }).first().waitFor()
      await page.evaluate(() => {
        window.__metricsRevoked = true
      })
      await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
      await page.getByText('Acesso negado a esta conta ou campanha.', { exact: true }).waitFor()
      assert.equal(await page.getByText('Impressões visíveis', { exact: true }).count(), 0)
      assert.deepEqual(errors, [])
      await page.screenshot({ path: join(tmpdir(), `ad-v2-${width}-${theme}.png`), fullPage: true })
      results.push({ width, theme, passed: true })
      await context.close()
    }
  await checkAdvertiserAdmin(browser, origin, results)
  await writeFile(join(tmpdir(), 'ad-v2-browser-results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} catch (error) {
  for (const context of browser?.contexts() || [])
    for (const page of context.pages()) {
      await page
        .screenshot({ path: join(tmpdir(), 'advertiser-admin-failure.png'), fullPage: true })
        .catch(() => {})
      console.error(
        'BROWSER_DIAGNOSTIC',
        await page
          .evaluate(() => ({
            text: document.body.innerText,
            calls: window.__calls,
            selection: document.querySelector('select')?.value,
            pending: window.__pendingReads?.length,
          }))
          .catch(() => ({}))
      )
    }
  throw error
} finally {
  await browser?.close()
  await new Promise((r) => server.close(r))
  await rm(dir, { recursive: true, force: true })
}

async function checkAdvertiserAdmin(browser, origin, results) {
  const open = async (suffix = '') => {
    const context = await browser.newContext({ viewport: { width: 375, height: 850 } })
    const page = await context.newPage()
    await page.goto(origin + '/?admin' + suffix)
    return { context, page }
  }
  const choose = async (page, id = 'A') => {
    await page.getByRole('combobox', { name: 'Anunciante', exact: true }).selectOption(id)
    if (id) await page.getByRole('region', { name: 'Visão geral' }).waitFor()
  }
  const dialog = (page, title) => page.getByRole('dialog', { name: title, exact: true })
  const count = async (page, title) =>
    page
      .getByRole('region', { name: 'Visão geral' })
      .locator('dl > div')
      .filter({ hasText: title })
      .locator('dd')
      .textContent()
  const fits = async (page) => {
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false
    )
    for (const d of await page.getByRole('dialog').all()) {
      const box = await d.boundingBox()
      assert.ok(box.x >= -1 && box.x + box.width <= page.viewportSize().width + 1)
      assert.ok(
        await d.evaluate((el) => el.contains(document.activeElement)),
        'dialog must contain keyboard focus'
      )
      assert.ok(await d.getAttribute('aria-labelledby'), 'dialog needs accessible title')
    }
  }
  for (const width of [320, 375, 768, 1280])
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 850 } })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(origin + '/?admin&theme=' + theme)
      await choose(page)
      await page.getByText('@ja_autorizado', { exact: true }).waitFor()
      assert.equal(await count(page, 'Campanhas vinculadas'), '1')
      assert.equal(await count(page, 'Usuários com acesso'), '1')
      assert.equal(await page.getByRole('textbox').count(), 0, 'no permanently exposed forms')
      assert.equal(
        await page.evaluate(
          () =>
            window.__calls.filter((c) => c.args.p_kind === 'campaigns' && !c.args.p_account_id)
              .length
        ),
        0,
        'do not preload global campaigns'
      )
      await fits(page)
      await page.screenshot({
        path: join(tmpdir(), `advertiser-admin-${width}-${theme}.png`),
        fullPage: true,
      })
      for (const [button, title] of [
        ['Novo anunciante', 'Novo anunciante'],
        ['Vincular campanha', 'Vincular campanha'],
        ['Conceder acesso', 'Conceder acesso'],
      ]) {
        const trigger = page.getByRole('button', { name: button, exact: true })
        await trigger.click()
        await dialog(page, title).waitFor()
        await fits(page)
        await page.keyboard.press('Tab')
        await fits(page)
        if (width === 320)
          await page.screenshot({
            path: join(tmpdir(), `advertiser-dialog-${title.split(' ')[0]}-${theme}.png`),
            fullPage: true,
          })
        await page.keyboard.press('Escape')
        await dialog(page, title).waitFor({ state: 'detached' })
        assert.equal(
          await trigger.evaluate((el) => el === document.activeElement),
          true,
          'focus must return to trigger'
        )
      }
      assert.deepEqual(errors, [])
      results.push({ advertiserAdmin: true, width, theme, dialogsAccessible: true, passed: true })
      await context.close()
    }
  {
    const { page, context } = await open()
    await choose(page)
    await page.getByRole('button', { name: 'Novo anunciante', exact: true }).click()
    const create = dialog(page, 'Novo anunciante')
    await create.getByRole('button', { name: 'Criar anunciante', exact: true }).click()
    const name = create.getByRole('textbox', { name: /Nome da empresa/ })
    assert.equal(await name.getAttribute('aria-invalid'), 'true')
    assert.ok(await name.getAttribute('aria-describedby'), 'validation is associated with field')
    await name.fill('Nova empresa')
    await page.evaluate(() => {
      window.__holdOperation = 'create'
    })
    await create.getByRole('button', { name: 'Criar anunciante', exact: true }).evaluate((el) => {
      el.click()
      el.click()
    })
    await create.getByRole('button', { name: 'Salvando…', exact: true }).waitFor()
    assert.equal(
      await create.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled(),
      true
    )
    await page.keyboard.press('Escape')
    assert.equal(await create.count(), 1)
    await page.evaluate(() => {
      window.__releaseOperation()
    })
    await create.waitFor({ state: 'detached' })
    await page.getByRole('heading', { name: 'Nova empresa', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('combobox', { name: 'Anunciante', exact: true }).inputValue(),
      'new'
    )
    assert.equal(
      await page.evaluate(
        () => window.__calls.filter((c) => c.args.p_operation === 'create').length
      ),
      1
    )
    await page.getByText('Nenhuma campanha vinculada.', { exact: false }).waitFor()
    await page.getByText('Nenhum usuário com acesso.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Ações da conta', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Renomear', exact: true }).click()
    const rename = dialog(page, 'Renomear anunciante')
    await rename.getByRole('textbox', { name: /Nome da empresa/ }).fill('Empresa renomeada')
    await rename.getByRole('button', { name: 'Salvar nome', exact: true }).click()
    await page.getByRole('heading', { name: 'Empresa renomeada', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Vincular campanha', exact: true }).click()
    const link = dialog(page, 'Vincular campanha')
    await link.getByRole('radio', { name: 'Campanha disponível 1', exact: true }).check()
    assert.equal(
      await link.getByRole('button', { name: 'Confirmar vinculação', exact: true }).isDisabled(),
      true
    )
    await link.getByText('O vínculo inclui todo o histórico', { exact: false }).waitFor()
    await link.getByText('Empresa de destino: Empresa renomeada', { exact: true }).waitFor()
    await link.getByRole('checkbox').check()
    await link.getByRole('button', { name: 'Confirmar vinculação', exact: true }).click()
    await page
      .getByRole('list', { name: 'Campanhas vinculadas', exact: true })
      .getByText('Campanha disponível 1', { exact: true })
      .waitFor()
    assert.ok(
      (
        await page
          .getByRole('link', { name: 'Ver métricas de Campanha disponível 1', exact: true })
          .getAttribute('href')
      ).includes('adId=available-1')
    )
    assert.equal(await count(page, 'Campanhas vinculadas'), '1')
    await page.getByRole('button', { name: 'Conceder acesso', exact: true }).click()
    const grant = dialog(page, 'Conceder acesso')
    await grant.getByRole('textbox', { name: 'Nome de usuário', exact: true }).fill('le')
    await grant.getByRole('button', { name: 'Buscar usuários', exact: true }).click()
    await grant.getByText('Digite pelo menos 3 caracteres', { exact: false }).waitFor()
    await grant.getByRole('textbox', { name: 'Nome de usuário', exact: true }).fill('inexistente')
    await grant.getByRole('button', { name: 'Buscar usuários', exact: true }).click()
    await grant.getByText('Nenhum usuário encontrado.', { exact: true }).waitFor()
    await grant.getByRole('textbox', { name: 'Nome de usuário', exact: true }).fill('leitor')
    await grant.getByRole('button', { name: 'Buscar usuários', exact: true }).click()
    await grant.getByRole('radio', { name: '@leitor_existente', exact: true }).check()
    await page.evaluate(() => {
      window.__failNext = { operation: 'grant' }
    })
    await grant.getByRole('button', { name: 'Confirmar acesso', exact: true }).click()
    await grant.getByRole('alert').waitFor()
    assert.equal(
      await page
        .getByRole('list', { name: 'Usuários autorizados', exact: true })
        .getByText('@leitor_existente', { exact: true })
        .count(),
      0
    )
    await grant.getByRole('button', { name: 'Confirmar acesso', exact: true }).click()
    await page
      .getByRole('list', { name: 'Usuários autorizados', exact: true })
      .getByText('@leitor_existente', { exact: true })
      .waitFor()
    await page.getByText('Visualização · Concedido em 24/10/2026', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Conceder acesso', exact: true }).click()
    const existing = dialog(page, 'Conceder acesso')
    await existing.getByRole('textbox', { name: 'Nome de usuário', exact: true }).fill('leitor')
    await existing.getByRole('button', { name: 'Buscar usuários', exact: true }).click()
    await existing.getByText('Já tem acesso de visualização.', { exact: true }).waitFor()
    assert.equal(
      await existing.getByRole('radio', { name: '@leitor_existente', exact: true }).isDisabled(),
      true
    )
    await page.keyboard.press('Escape')
    await page
      .getByRole('button', { name: 'Revogar acesso de @leitor_existente', exact: true })
      .click()
    const revoke = dialog(page, 'Revogar acesso')
    await revoke.getByText('histórico será preservado.', { exact: false }).waitFor()
    await revoke.getByRole('button', { name: 'Cancelar', exact: true }).click()
    assert.equal(await page.getByText('@leitor_existente', { exact: true }).count(), 1)
    await page
      .getByRole('button', { name: 'Revogar acesso de @leitor_existente', exact: true })
      .click()
    await dialog(page, 'Revogar acesso')
      .getByRole('button', { name: 'Revogar acesso', exact: true })
      .click()
    await page.getByText('Nenhum usuário com acesso.', { exact: false }).waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Conceder acesso', exact: true })
        .evaluate((el) => el === document.activeElement),
      true
    )
    await page.getByRole('button', { name: 'Ações da conta', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Desativar conta', exact: true }).click()
    const deactivate = dialog(page, 'Desativar conta')
    await deactivate
      .getByText('Os acessos aos relatórios serão bloqueados', { exact: false })
      .waitFor()
    await deactivate.getByRole('button', { name: 'Desativar conta', exact: true }).click()
    await page.getByText('Inativa', { exact: true }).waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Visualizar portal do anunciante', exact: true })
        .isDisabled(),
      true
    )
    await page.getByRole('button', { name: 'Ações da conta', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Reativar conta', exact: true }).click()
    await dialog(page, 'Reativar conta')
      .getByRole('button', { name: 'Reativar conta', exact: true })
      .click()
    await page.getByRole('link', { name: 'Visualizar portal do anunciante', exact: true }).waitFor()
    results.push({
      adminLifecycle: true,
      creationRenameLinkGrantRevokeStatus: true,
      validationErrorsDuplicatePrevention: true,
      passed: true,
    })
    await context.close()
  }
  {
    const { page, context } = await open()
    await choose(page, 'B')
    await page.getByText('Nenhuma campanha vinculada.', { exact: false }).waitFor()
    await page.evaluate(() => {
      window.__delayAccount = 'A'
    })
    await choose(page, 'A')
    await page.getByRole('status').filter({ hasText: 'Carregando campanhas…' }).waitFor()
    await choose(page, 'B')
    await page.evaluate(() => {
      window.__pendingReads.forEach((resolve) => resolve())
      window.__delayAccount = null
    })
    await page.getByText('Nenhuma campanha vinculada.', { exact: false }).waitFor()
    assert.equal(await page.getByText('Campanha vinculada A', { exact: true }).count(), 0)
    assert.equal(await page.getByText('@ja_autorizado', { exact: true }).count(), 0)
    await page.evaluate(() => {
      window.__failNext = { code: '42501' }
    })
    await page.getByRole('combobox', { name: 'Anunciante', exact: true }).selectOption('A')
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByRole('region', { name: 'Visão geral' }).count(), 0)
    results.push({ accountRaceAndDenial: true, passed: true })
    await context.close()
  }
  {
    const { page, context } = await open()
    await page.getByRole('combobox', { name: 'Anunciante', exact: true }).waitFor()
    await page.evaluate(() => {
      window.__advertisers.members.A = Array.from({ length: 101 }, (_, i) => ({
        id: 'member-' + i,
        username: i === 100 ? 'ultimo_autorizado' : 'revogado_' + i,
        granted_at: '2026-10-24T12:00:00Z',
        revoked_at: i === 100 ? null : '2026-10-24T13:00:00Z',
      }))
      window.__advertisers.linked.A = Array.from({ length: 101 }, (_, i) => ({
        id: 'many-' + i,
        title: 'Campanha ' + i,
        deleted: false,
      }))
      window.__advertisers.available.splice(
        0,
        window.__advertisers.available.length,
        ...Array.from({ length: 100 }, (_, i) => ({
          id: 'available-' + i,
          title: 'Disponível ' + i,
        })),
        { id: 'last', title: 'Alvo futuro' }
      )
    })
    await choose(page, 'A')
    await page.getByRole('button', { name: 'Carregar mais campanhas', exact: true }).waitFor()
    assert.equal(await count(page, 'Campanhas vinculadas'), '100')
    assert.equal(await count(page, 'Usuários com acesso'), '0')
    await page
      .getByText('Nenhum acesso ativo entre os usuários carregados.', { exact: false })
      .waitFor()
    await page.getByRole('button', { name: 'Carregar mais acessos', exact: true }).click()
    await page.getByText('@ultimo_autorizado', { exact: true }).waitFor()
    assert.equal(await count(page, 'Usuários com acesso'), '1')
    await page.getByRole('button', { name: 'Carregar mais campanhas', exact: true }).click()
    await page.getByText('Campanha 100', { exact: true }).waitFor()
    assert.equal(await count(page, 'Campanhas vinculadas'), '101')
    await page.getByRole('button', { name: 'Vincular campanha', exact: true }).click()
    const link = dialog(page, 'Vincular campanha')
    await link
      .getByRole('textbox', { name: 'Pesquisar campanhas disponíveis', exact: true })
      .fill('Alvo futuro')
    await link
      .getByText('Nenhuma campanha encontrada entre os itens carregados.', { exact: true })
      .waitFor()
    await link
      .getByRole('button', { name: 'Carregar mais campanhas disponíveis', exact: true })
      .click()
    await link.getByRole('radio', { name: 'Alvo futuro', exact: true }).check()
    await link.getByRole('checkbox').check()
    await page.evaluate(() => {
      window.__failNext = { operation: 'link', message: 'CAMPAIGN_OWNER_IMMUTABLE' }
    })
    await link.getByRole('button', { name: 'Confirmar vinculação', exact: true }).click()
    await link.getByText('Esta campanha já possui um anunciante.', { exact: false }).waitFor()
    results.push({ adminPaginationSearchAndImmutableOwnership: true, passed: true })
    await context.close()
  }
  {
    const { page, context } = await open('&empty&slow')
    await page.getByRole('status').filter({ hasText: 'Carregando anunciantes…' }).waitFor()
    await page.evaluate(() => window.__releaseAccounts())
    await page.getByText('Nenhum anunciante cadastrado.', { exact: false }).waitFor()
    assert.equal(await page.getByRole('textbox').count(), 0)
    results.push({ adminInitialLoadingAndEmpty: true, passed: true })
    await context.close()
  }
}
