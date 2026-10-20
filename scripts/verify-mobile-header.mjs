// Smoke visual do CSS do header; não exige sessão nem servidor em execução.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const appCss = await readFile(resolve('src/styles/app.css'), 'utf8')
const navigationCss = await readFile(resolve('src/styles/navigation.css'), 'utf8')
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_EXECUTABLE ||
    '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  const page = await browser.newPage()
  for (const dark of [false, true]) {
    for (const width of [320, 360, 375, 390, 430, 767, 768, 1024]) {
      for (const [coins, cash] of [
        ['56', '295'],
        ['123.456.789.012', '987.654.321.098'],
      ]) {
        await page.setViewportSize({ width, height: 800 })
        await page.setContent(`
          <style>
            :root {
              --bgColor-default: ${dark ? '#0d1117' : '#fff'};
              --fgColor-default: ${dark ? '#f0f6fc' : '#1f2328'};
              --borderColor-muted: ${dark ? '#30363d' : '#d0d7de'};
            }
            ${appCss}
            ${navigationCss}
          </style>
          <div class="app-shell">
            <header class="app-header">
              <div class="header-top">
                <a class="brand" href="/app">
                  <span class="brand-mark"><svg width="25" height="25" aria-hidden="true"></svg></span>
                  <span class="brand-text">Evolutus</span>
                </a>
                <nav class="desktop-nav"><a class="nav-link" href="/app">Início</a></nav>
                <div class="header-actions">
                  <a class="wallet-header-badges" href="/entenda-suas-moedas" aria-label="Entenda suas moedas e veja seus saldos de EvoCoins e EvoCash">
                    <span class="wallet-badge" title="${coins} EvoCoins"><svg class="wallet-badge-icon" width="14" height="14"></svg><span class="wallet-badge-value">${coins}</span></span>
                    <span class="wallet-badge" title="${cash} EvoCash"><svg class="wallet-badge-icon" width="14" height="14"></svg><span class="wallet-badge-value">${cash}</span></span>
                    <span class="wallet-badges-help">?</span>
                  </a>
                  <div class="notification-bell"><button class="notification-trigger" aria-label="Notificações">Sino</button></div>
                  <button class="account-menu-trigger" aria-label="Menu da conta">Menu</button>
                </div>
              </div>
            </header>
          </div>
        `)
        const result = await page.evaluate(() => {
          const brand = document.querySelector('.brand')
          const text = document.querySelector('.brand-text')
          const wallet = document.querySelector('.wallet-header-badges')
          const badges = [...document.querySelectorAll('.wallet-badge')]
          const values = [...document.querySelectorAll('.wallet-badge-value')]
          const help = document.querySelector('.wallet-badges-help')
          const bell = document.querySelector('.notification-trigger')
          const menu = document.querySelector('.account-menu-trigger')
          const rect = (element) => element.getBoundingClientRect()
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            brandClipped:
              rect(text).left < 0 ||
              rect(text).right > innerWidth ||
              getComputedStyle(brand).overflow === 'hidden',
            walletVisible: getComputedStyle(wallet).display !== 'none',
            helpVisible: getComputedStyle(help).display !== 'none' && rect(help).width > 0,
            helpLink: wallet.getAttribute('href'),
            badgesVisible: badges.every((badge) => rect(badge).width > 0),
            iconsVisible: badges.every((badge) => rect(badge.querySelector('svg')).width === 14),
            order:
              rect(brand).right <= rect(badges[0]).left &&
              rect(badges[0]).right <= rect(badges[1]).left &&
              rect(badges[1]).right <= rect(help).left &&
              rect(help).right <= rect(bell).left &&
              rect(bell).right <= rect(menu).left,
            ordinaryValuesFit: values.every((value) => value.scrollWidth <= value.clientWidth),
            bellSize: [rect(bell).width, rect(bell).height],
            menuSize: [rect(menu).width, rect(menu).height],
          }
        })
        const mobile = width < 768
        const ordinary = coins === '56'
        if (
          result.overflow ||
          (mobile && result.brandClipped) ||
          !result.walletVisible ||
          !result.badgesVisible ||
          !result.iconsVisible ||
          !result.order ||
          !result.helpVisible ||
          result.helpLink !== '/entenda-suas-moedas' ||
          (ordinary && !result.ordinaryValuesFit) ||
          (mobile && [...result.bellSize, ...result.menuSize].some((size) => size < 44))
        ) {
          throw new Error(
            `${dark ? 'escuro' : 'claro'} ${width}px ${ordinary ? 'normal' : 'longo'}: ${JSON.stringify(result)}`
          )
        }
        process.stdout.write(
          `ok ${dark ? 'escuro' : 'claro'} ${width}px ${ordinary ? 'normal' : 'longo'}\n`
        )
      }
    }
  }
} finally {
  await browser.close()
}
