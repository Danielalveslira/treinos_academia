import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
const phase = process.argv[2] || 'before'
const folder = `docs/public-home-v2-evidence/${phase}`
mkdirSync(folder, {recursive:true})
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/tmp/pr84-release-browser/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']})
const geometry=[]
try {
 for (const width of [320,390,768,1440]) for (const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme})
  await page.addInitScript(mode=>localStorage.setItem('colorMode',mode),theme)
  await page.goto(process.env.PUBLIC_PREVIEW_URL||'http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'})
  await page.screenshot({path:`${folder}/home-${width}-${theme}.png`,fullPage:true})
  await page.getByRole('button',{name:'Menu de navegação'}).click()
  await page.waitForTimeout(250)
  geometry.push({width,theme,layout:await page.locator('.public-header-overlay').evaluate(el=>({box:el.getBoundingClientRect().toJSON(),html:el.outerHTML,scroll:el.scrollTop}))})
  await page.screenshot({path:`${folder}/menu-${width}-${theme}.png`})
  await page.close()
 }
 writeFileSync(`${folder}/geometry.json`,JSON.stringify(geometry,null,2))
}finally{await browser.close()}
