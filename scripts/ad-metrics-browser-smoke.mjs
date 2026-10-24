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
 const accounts=[{id:'A',name:'Empresa A',active:true},{id:'B',name:'Empresa B',active:true}]
 const campaigns=[{id:'campaign-A',title:'Campanha A',partner_name:'Marca A',deleted:false},{id:'removed-A',title:'Histórico A',partner_name:'Marca A',deleted:true}]
 const metrics={visible_impressions:10,unique_viewers:5,clicks:20,unqualified_clicks:2,qualified_clicks:18,ctr_qualified:180,ctr_raw:200}
 export async function readCatalog(name,args={}) {
  if(name==='list_advertiser_accounts') return [...accounts]
  if(name==='list_advertiser_campaigns') return campaigns.map(c=>({...c,id:c.id.replace(/A$/,args.p_account_id)}))
  if(args.p_kind==='users') return [{id:'reader',username:'leitor_existente'}]
  if(args.p_kind==='members') return window.__granted?[{id:'reader',username:'leitor_existente',granted_at:'2026-10-24',revoked_at:window.__revokedMember?'2026-10-24':null}]:[]
  return args.p_account_id?[]:[{id:'unassigned',title:'Campanha não atribuída'}]
 }
 export async function advertiserRpc(name,args) {
  if(name==='admin_manage_advertiser') {
   if(args.p_operation==='create') {accounts.push({id:'new',name:args.p_name,active:true});return 'new'}
   if(args.p_operation==='grant') window.__granted=true
   if(args.p_operation==='revoke') window.__revokedMember=true
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
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'rpc'
              ? fixture
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
  const page = await browser.newPage()
  await page.goto(origin + '/?admin')
  await page
    .getByRole('textbox', { name: 'Nome da nova conta', exact: true })
    .fill('Novo anunciante')
  await page.getByRole('button', { name: 'Criar anunciante', exact: true }).click()
  await page.getByRole('textbox', { name: 'Nome público da conta', exact: true }).waitFor()
  await page
    .getByRole('textbox', { name: 'Buscar usuário pelo nome de usuário', exact: true })
    .fill('leitor')
  await page.getByRole('button', { name: 'Buscar usuário existente', exact: true }).click()
  await page.getByRole('button', { name: 'Conceder leitura', exact: true }).click()
  await page.getByRole('button', { name: 'Revogar leitura', exact: true }).click()
  await page.getByText('leitor_existente · Revogado', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Desativar conta', exact: true }).click()
  await page.getByRole('button', { name: 'Reativar conta', exact: true }).waitFor()
  results.push({ adminFlow: true, passed: true })
  await writeFile(join(tmpdir(), 'ad-v2-browser-results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} finally {
  await browser?.close()
  await new Promise((r) => server.close(r))
  await rm(dir, { recursive: true, force: true })
}
