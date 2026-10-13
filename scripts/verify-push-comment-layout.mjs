// Synthetic browser fixtures only; uses real page/components/styles and the real SW click handler.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, extname, relative, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import vm from 'node:vm'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
const mode = process.argv[2] || 'after'
const baseline = process.env.PUSH_LAYOUT_BASELINE || 'acb5321bb4d17183dfa1c0c255bb912ede3bd2be'
const baselineSource = (file) =>
  execFileSync('git', ['show', `${baseline}:${relative(process.cwd(), file)}`], {
    encoding: 'utf8',
  })
const out = resolve('/tmp/evolutus-push-layout', mode)
await mkdir(out, { recursive: true })
const statusId = '11111111-1111-4111-8111-111111111111'
const communityId = '22222222-2222-4222-8222-222222222222'
const commentId = '33333333-3333-4333-8333-333333333333'
const path = `/comunidades/${communityId}/publicacoes/${statusId}/comentarios/${commentId}`
const token = 'semquebra'.repeat(65)
const markdown =
  '# Publicação extensa\n\n' +
  Array.from(
    { length: 6 },
    (_, i) =>
      `## Seção ${i + 1}\n\nTexto longo de uma publicação, para testar leitura, expansão e navegação mobile. `.repeat(
        3
      ) +
      '\n\n- Lista com texto e links\n- ' +
      token +
      '\n\n'
  ).join('') +
  '\n| Exercício | Descrição | Carga | Repetições | Observação |\n| --- | --- | --- | --- | --- |\n| Agachamento | ' +
  token +
  ' | 80 kg | 12 | Boa execução |\n\nFim da publicação.'
assert.ok(markdown.length <= 7000, 'fixture respects publication text limit')
const status = {
  id: statusId,
  communityId,
  authorId: 'author',
  authorUsername: token.slice(0, 50),
  type: 'text',
  text: markdown,
  createdAt: '2026-10-13T12:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z',
  commentCount: 3,
}
const comments = Array.from({ length: 3 }, (_, i) => ({
  id: i === 2 ? commentId : `ancestor-${i}`,
  statusId,
  authorId: 'author-' + i,
  authorUsername: token.slice(0, 45),
  createdAt: '2026-10-13T12:00:00Z',
  status: 'active',
  body: ('Comentário longo com resposta e palavras extensas: ' + token + '\n').repeat(
    i === 2 ? 3 : 2
  ),
  replyCount: i === 2 ? 1 : 0,
  likeCount: 2,
  depth: i,
}))
const fixture = {
  status,
  community: { id: communityId, name: 'Comunidade ' + token.slice(0, 80), ownerId: 'owner' },
  context: { statusId, communityId, comments },
}
const source = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,Link} from 'react-router-dom';
import {ThemeProvider,BaseStyles} from '@primer/react';
import CommentContextPage from './src/features/comments/pages/CommentContextPage.jsx';
import {StatusCard} from './src/components/StatusCard.jsx';
import {ThemeSync} from './src/components/ThemeSync.jsx';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import {CommentCard} from './src/features/comments/components/CommentCard.jsx';
import './src/styles/app.css'; import './src/styles/navigation.css';
const fixture=${JSON.stringify(fixture)};
function Feed(){React.useEffect(()=>{const css=document.createElement('link');css.rel='stylesheet';css.href='/community-feed.css';document.head.append(css)},[]);return <><StatusCard status={fixture.status} currentUserId="reader" myEconomyVote={null} now={Date.now()} /><Link data-testid="open-comment" to="${path}">Abrir comentário da notificação</Link><CommentCard comment={fixture.context.comments[0]} communityId="${communityId}" currentUserId="reader" allowWrite /></>}
const dark=new URLSearchParams(location.search).has('dark');
createRoot(document.getElementById('root')).render(<ThemeProvider colorMode={dark?'night':'day'} dayScheme="light" nightScheme="dark"><BaseStyles><ThemeSync/><div className="app-shell"><header className="app-header"><div className="header-top"><span>EVOLUTUS</span></div></header><div className="main-content"><BrowserRouter><Routes><Route path="/feed" element={<Feed/>}/><Route path="/comunidades/:id/publicacoes/:statusId/comentarios/:commentId" element={<CommentContextPage/>}/></Routes></BrowserRouter></div><nav className="mobile-nav"><a className="nav-link"><span>Início</span></a><a className="nav-link"><span>Exercícios</span></a><a className="nav-link"><span>Treinar</span></a><a className="nav-link"><span>Progresso</span></a><a className="nav-link"><span>Comunidades</span></a></nav></div></BaseStyles></ThemeProvider>);
`
await build({
  stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' },
  outdir: out,
  bundle: true,
  format: 'esm',
  splitting: true,
  jsx: 'automatic',
  entryNames: 'app',
  logLevel: 'silent',
  define: { 'import.meta.env': '{}' },
  plugins: [
    {
      name: 'synthetic-data',
      setup(b) {
        if (mode === 'before') {
          b.onLoad(
            {
              filter:
                /(?:ExpandableContent|CommentContextPage|CommentCard)\.jsx$|\/styles\/app\.css$/,
            },
            (args) => ({
              contents: baselineSource(args.path),
              loader: args.path.endsWith('.css') ? 'css' : 'jsx',
              resolveDir: dirname(args.path),
            })
          )
        }
        b.onResolve({ filter: /\/hooks\/useAuth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
        b.onLoad({ filter: /^auth$/, namespace: 'fixture' }, () => ({
          contents: `export const useAuth=()=>({user:{uid:'reader'},isSuperAdmin:false})`,
        }))
        b.onResolve(
          {
            filter:
              /\/services\/(statusesService|communitiesService|profileAvatarService)(\.js)?$|\/api\/comments\.api(\.js)?$/,
          },
          (args) => ({
            path: resolve(args.resolveDir, args.path + (args.path.endsWith('.js') ? '' : '.js')),
            namespace: 'fixture-api',
          })
        )
        b.onLoad({ filter: /.*/, namespace: 'fixture-api' }, async (args) => {
          const original = await readFile(args.path, 'utf8')
          const names = [
            ...original.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g),
          ].map((m) => m[1])
          return {
            contents:
              `const fixture=${JSON.stringify(fixture)};` +
              names
                .map((n) =>
                  n === 'getCommentContext'
                    ? `export const ${n}=async()=>{await new Promise(r=>setTimeout(r,50));return fixture.context};`
                    : n === 'getStatusSummary'
                      ? `export const ${n}=async()=>fixture.status;`
                      : n === 'getCommunitySummary'
                        ? `export const ${n}=async()=>fixture.community;`
                        : n === 'listReplies'
                          ? `export const ${n}=async()=>[fixture.context.comments[2] && {...fixture.context.comments[2],id:'reply-fixture',body:'Resposta longa '+fixture.context.comments[2].body,replyCount:0}];`
                          : /^[A-Z_]+$/.test(n)
                            ? `export const ${n}=20;`
                            : `export const ${n}=async()=>[];`
                )
                .join('\n'),
          }
        })
        b.onResolve({ filter: /\/supabase\/config(\.js)?$/ }, () => ({
          path: 'supabase',
          namespace: 'fixture',
        }))
        b.onLoad({ filter: /^supabase$/, namespace: 'fixture' }, () => ({
          contents: `export const supabase={auth:{getSession:async()=>({data:{session:null}})},from:()=>({select:()=>({in:async()=>({data:[],error:null})})})}`,
        }))
      },
    },
  ],
})
await writeFile(
  resolve(out, 'index.html'),
  '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'
)
const server = createServer(async (req, res) => {
  try {
    const file = req.url.startsWith('/community-feed.css')
      ? resolve('src/styles/community-feed.css')
      : resolve(out, req.url.split('?')[0].slice(1))
    const target = extname(file) ? file : resolve(out, 'index.html')
    res.setHeader(
      'content-type',
      extname(target) === '.js'
        ? 'text/javascript'
        : extname(target) === '.css'
          ? 'text/css'
          : 'text/html'
    )
    res.end(
      mode === 'before' && req.url.startsWith('/community-feed.css')
        ? baselineSource(target)
        : await readFile(target)
    )
  } catch {
    res.statusCode = 404
    res.end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const results = []
async function metrics(page) {
  return page.evaluate(() => {
    const summary = document.querySelector('.comment-publication-summary')
    const body = document.querySelector('.expandable-body')
    const toggle = document.querySelector('.expandable-toggle')
    const table = document.querySelector('[role="region"]')
    const card = document.querySelector('.comment-card.is-highlighted')
    const header = document.querySelector('.app-header')
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
      summaryWidth: summary?.getBoundingClientRect().width,
      bodyOverflow: body && getComputedStyle(body).overflowY,
      bodyHeight: body?.getBoundingClientRect().height,
      innerHeight: body?.firstElementChild?.getBoundingClientRect().height,
      toggleWidth: toggle?.getBoundingClientRect().width,
      tableWidth: table?.getBoundingClientRect().width,
      tableScrollWidth: table?.scrollWidth,
      targetTop: card?.getBoundingClientRect().top,
      headerBottom: header.getBoundingClientRect().bottom,
    }
  })
}
// Execute the production worker's notificationclick handler; browser windows are real.
const swTemplate = await readFile('scripts/service-worker.js', 'utf8')
async function push(context, existing, target) {
  const handlers = {}
  let page = existing
  const self = {
    location: { origin },
    addEventListener: (n, h) => (handlers[n] = h),
    clients: {
      matchAll: async () =>
        existing
          ? [
              {
                url: existing.url(),
                navigate: async (url) => {
                  await existing.goto(url)
                  return { focus: async () => existing.bringToFront() }
                },
              },
            ]
          : [],
      openWindow: async (url) => {
        page = await context.newPage()
        await page.goto(url)
        return { focus: async () => page.bringToFront() }
      },
    },
  }
  const sw = swTemplate
    .replace('__SHELL_URLS__', '[]')
    .replace('__BOOT_ASSETS__', '[]')
    .replace('__OFFLINE_ASSETS__', '[]')
    .replace('__PUSH_ACK_URL__', '""')
    .replace('__PUSH_ACK_KEY__', '""')
    .replace('__EXERCISE_VISUALS_PREFIX__', '""')
  vm.runInNewContext(sw, {
    self,
    URL,
    Response,
    Request,
    Headers,
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch,
  })
  let work
  handlers.notificationclick({
    notification: { data: { targetUrl: target }, close() {} },
    waitUntil: (p) => (work = p),
  })
  await work
  return page
}
try {
  for (const width of [320, 360, 390, 430]) {
    for (const dark of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } })
      let page = await push(context, null, path + (dark ? '?dark' : ''))
      await page.locator('.comment-card.is-highlighted').waitFor()
      const initial = await metrics(page)
      const actualTheme = await page.evaluate(() => document.documentElement.dataset.colorMode)
      assert.equal(actualTheme, dark ? 'dark' : 'light')
      await page.screenshot({
        path: resolve(out, `${width}-${dark ? 'dark' : 'light'}-target.png`),
      })
      if (mode !== 'before')
        assert.ok(
          initial.targetTop >= initial.headerBottom - 1 && initial.targetTop < 768,
          'push target visible after async context'
        )
      await page.locator('.comment-publication-summary').scrollIntoViewIfNeeded()
      await page.locator('.expandable-toggle').waitFor()
      await page.locator('h2').filter({ hasText: 'Seção 1' }).first().waitFor()
      await page.waitForTimeout(120)
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({
        path: resolve(out, `${width}-${dark ? 'dark' : 'light'}-publication.png`),
      })
      const cold = await metrics(page)
      await page.screenshot({
        path: resolve(out, `${width}-${dark ? 'dark' : 'light'}-cold.png`),
        fullPage: true,
      })
      await page
        .locator('.expandable-body')
        .evaluate((el) =>
          window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - 350)
        )
      await page.screenshot({
        path: resolve(out, `${width}-${dark ? 'dark' : 'light'}-collapse-boundary.png`),
      })
      results.push({ width, dark, initial, cold })
      if (mode !== 'before') {
        assert.equal(cold.pageWidth, width)
        assert.equal(cold.bodyOverflow, 'hidden')
        assert.ok(cold.summaryWidth <= width)
        assert.ok(cold.toggleWidth > 200)
        assert.equal(
          await page.evaluate(() => document.activeElement.id),
          `comentario-${commentId}`
        )
        assert.ok(
          await page.evaluate(() => {
            const button = document.querySelector('.expandable-toggle').getBoundingClientRect()
            const body = document.querySelector('.expandable-body').getBoundingClientRect()
            const summary = document
              .querySelector('.comment-publication-summary')
              .getBoundingClientRect()
            const conversation = document
              .querySelector('.comment-context-conversation')
              .getBoundingClientRect()
            return (
              button.top >= body.bottom &&
              button.bottom <= summary.bottom &&
              conversation.top >= summary.bottom
            )
          }),
          'button, publication and comments do not overlap'
        )
      }
      await page.locator('.expandable-toggle').click()
      await page.getByRole('button', { name: 'Ver menos' }).waitFor()
      await page.locator('[role="region"]').waitFor()
      const expanded = await metrics(page)
      results.at(-1).expanded = expanded
      await page.screenshot({
        path: resolve(out, `${width}-${dark ? 'dark' : 'light'}-expanded.png`),
        fullPage: true,
      })
      if (mode !== 'before') {
        assert.equal(expanded.pageWidth, width)
        assert.ok(expanded.tableWidth < width)
        assert.ok(expanded.tableScrollWidth > expanded.tableWidth)
        const scrolled = await page.locator('[role="region"]').evaluate((el) => {
          el.scrollLeft = 100
          return el.scrollLeft
        })
        assert.ok(scrolled > 0)
      }
      await page.getByRole('button', { name: 'Ver menos' }).click()
      await page.getByRole('button', { name: 'Ver mais' }).waitFor()
      await page.goto(origin + '/feed' + (dark ? '?dark' : ''))
      await page.getByRole('button', { name: 'Ver mais' }).waitFor()
      await page.screenshot({
        path: resolve(out, `${width}-${dark ? 'dark' : 'light'}-feed.png`),
        fullPage: true,
      })
      assert.equal((await metrics(page)).pageWidth, width)
      await page.locator('[data-testid="open-comment"]').click()
      await page.locator('.comment-card.is-highlighted').waitFor()
      await page.waitForTimeout(120)
      if (mode !== 'before') assert.equal((await metrics(page)).pageWidth, width)
      page = await push(context, page, path + (dark ? '?dark' : ''))
      await page.locator('.comment-card.is-highlighted').waitFor()
      await page.waitForTimeout(120)
      const warm = await metrics(page)
      results.at(-1).warm = warm
      if (mode !== 'before') {
        assert.equal(warm.pageWidth, width)
        assert.ok(warm.targetTop >= warm.headerBottom - 1 && warm.targetTop < 768)
      }
      await page.getByRole('button', { name: 'Ver 1 resposta' }).click()
      await page.locator('#comentario-reply-fixture').waitFor()
      assert.equal((await metrics(page)).pageWidth, width)
      await page.screenshot({
        path: resolve(out, `${width}-${dark ? 'dark' : 'light'}-replies.png`),
        fullPage: true,
      })
      await page.mouse.wheel(0, 300)
      const y = await page.evaluate(() => scrollY)
      await page.mouse.wheel(0, -150)
      await page.waitForTimeout(80)
      assert.notEqual(await page.evaluate(() => scrollY), y, 'normal vertical scroll')
      await context.close()
    }
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ mode, cases: results.length, screenshots: out, results }))
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
}
