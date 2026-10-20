// Renderiza a página real em Chromium com carteira sintética. Não acessa Supabase.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(join(tmpdir(), 'economy-guide-browser-'))
try {
  const result = await build({
    stdin: {
      contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { MemoryRouter } from 'react-router-dom'
        import EconomyGuide from './src/pages/EconomyGuide.jsx'
        const root = createRoot(document.getElementById('root'))
        window.__renderGuide = (uid) => {
          window.__guideUid = uid
          root.render(<MemoryRouter><EconomyGuide /></MemoryRouter>)
        }
        window.__renderGuide('synthetic-user')
      `,
      resolveDir: process.cwd(),
      loader: 'jsx',
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    outfile: join(directory, 'fixture.js'),
    metafile: true,
    logLevel: 'silent',
    plugins: [
      {
        name: 'economy-guide-browser-stubs',
        setup(ctx) {
          ctx.onResolve({ filter: /hooks\/useWallet$/ }, () => ({
            path: 'wallet',
            namespace: 'stub',
          }))
          ctx.onResolve({ filter: /hooks\/useAuth$/ }, () => ({ path: 'auth', namespace: 'stub' }))
          ctx.onResolve({ filter: /services\/economyService$/ }, () => ({
            path: 'service',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^wallet$/, namespace: 'stub' }, () => ({
            contents:
              "export const useWallet = () => ({ display: { coinBalance: 1250, cashBalance: 25, source: 'server' }, loading: false, error: null })",
          }))
          ctx.onLoad({ filter: /^auth$/, namespace: 'stub' }, () => ({
            contents: 'export const useAuth = () => ({ user: { uid: window.__guideUid } })',
          }))
          ctx.onLoad({ filter: /^service$/, namespace: 'stub' }, () => ({
            contents:
              "export const listMyEconomyTransactions = async () => [{ id: '1', asset: 'coin', direction: 'credit', amount: 2, reason: 'workout_completed', created_at: '2026-10-20T12:00:00Z' }]",
          }))
        },
      },
    ],
  })
  const js = await readFile(join(directory, 'fixture.js'), 'utf8')
  const cssPath = Object.keys(result.metafile.outputs).find((path) => path.endsWith('.css'))
  const css = cssPath ? await readFile(cssPath, 'utf8') : ''
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox'],
  })
  try {
    for (const width of [375, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.setContent(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'
      )
      await page.addStyleTag({
        content: `:root { color-scheme: dark; --bgColor-muted: #1d2721; --fgColor-default: #f0f6f1; --fgColor-muted: #bdc9be; --fgColor-success: #6de99c; --fgColor-accent: #8dc5ff; --borderColor-muted: #415347; --borderColor-default: #67806c; } body { margin: 0; padding: 16px; background: #101711; color: var(--fgColor-default); font: 16px system-ui; } a { color: var(--fgColor-accent); } ${css}`,
      })
      await page.addScriptTag({ content: js })
      await page.getByRole('heading', { name: 'Entenda suas moedas' }).waitFor()
      assert.equal(await page.locator('a[href="/evocash"]').count(), 2)
      assert.equal(await page.locator('a[href="/minhas-promocoes"]').count(), 1)
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `overflow em ${width}px`
      )
      await page.getByRole('button', { name: 'Ver movimentações' }).click()
      await page.getByText('Treino concluído').waitFor()
      if (process.env.ECONOMY_GUIDE_SCREENSHOT_DIR) {
        await page.screenshot({
          path: join(process.env.ECONOMY_GUIDE_SCREENSHOT_DIR, `economy-guide-${width}.png`),
          fullPage: true,
        })
      }
      await page.evaluate(() => window.__renderGuide('second-user'))
      await page.getByRole('button', { name: 'Ver movimentações' }).waitFor()
      assert.equal(
        await page.getByText('Treino concluído').count(),
        0,
        'extrato anterior não aparece após trocar de conta'
      )
      await page.close()
    }
    console.log(
      'ECONOMY_GUIDE_BROWSER_OK: 375px, 768px, 1440px; links, extrato, troca de conta e sem overflow'
    )
  } finally {
    await browser.close()
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
