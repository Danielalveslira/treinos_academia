import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'
import {mkdirSync,writeFileSync} from 'node:fs'
const base=process.env.PUBLIC_PREVIEW_URL||'http://127.0.0.1:4174'
const folder='docs/public-home-v2-evidence'
mkdirSync(folder+'/validated',{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/tmp/pr84-release-browser/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']})
const report={fixtureCount:1234,realProductionCount:false,layouts:[],reloads:10,turboReturns:10,catalogueReads:[],snapshotRequests:0,failures:[]}
try {
 for(const width of [320,390,768,1440])for(const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(mode=>{
   localStorage.setItem('colorMode',mode)
   window.metrics={cls:0,lcp:0,interactions:[]}
   new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.metrics.cls+=e.value}).observe({type:'layout-shift',buffered:true})
   new PerformanceObserver(list=>{for(const e of list.getEntries())window.metrics.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true})
   new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.interactionId)window.metrics.interactions.push(e.duration)}).observe({type:'event',buffered:true,durationThreshold:16})
  },theme)
  await page.goto(base,{waitUntil:'networkidle'})
  await page.locator('.home-image img').evaluate(img=>img.decode())
  const target=page.locator('[data-catalog-count]')
  await target.scrollIntoViewIfNeeded()
  await target.getByText('1.234 exercícios publicados',{exact:true}).waitFor()
  assert.equal(await page.locator('main h1').count(),1)
  assert.equal(await page.locator('.home-feature').count(),4)
  assert.equal(await page.locator('.home-catalog a').getAttribute('href'),'/cadastro')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:`${folder}/validated/home-${width}-${theme}-fixture.png`,fullPage:true})
  for(const height of [900,420]) {
   await page.waitForTimeout(400) // let the preceding native View Transition finish before resizing
   await page.setViewportSize({width,height})
   for(const scroll of [0,600]) {
    await page.evaluate(y=>window.scrollTo(0,y),scroll)
    const trigger=page.getByRole('button',{name:'Menu de navegação'})
    await trigger.click()
    const overlay=page.locator('.public-header-overlay');await overlay.waitFor()
    await page.waitForTimeout(220)
    const box=await overlay.boundingBox()
    const header=await page.locator('#public-header').boundingBox()
    const anchor=await trigger.boundingBox()
    assert.ok(Math.abs(box.y-header.y-header.height-8)<1,`header gap ${width}: ${JSON.stringify({box,header})}`)
    assert.ok(Math.abs(box.x+box.width-anchor.x-anchor.width)<1,`horizontal anchor ${width}`)
    const corners=await overlay.evaluate(el=>{const r=el.getBoundingClientRect();const style=getComputedStyle(el);return {radius:parseFloat(style.borderTopLeftRadius),hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+1)),position:style.position}})
    assert.ok(corners.radius>0&&corners.hit,'top border/corners must be unobstructed')
    assert.equal(corners.position,'fixed')
    await page.evaluate(()=>window.scrollBy(0,120))
    const scrolledBox=await overlay.boundingBox()
    assert.ok(Math.abs(scrolledBox.y-box.y)<1,'open panel stays below sticky header while scrolling')
    assert.ok(box.y>=0&&box.y+box.height<=height+1,`viewport ${width}/${height}/${scroll} ${JSON.stringify(box)}`)
    const first=overlay.locator('a').first();const item=await first.boundingBox()
    assert.ok(item.y>=box.y&&item.y+item.height<=box.y+box.height,`first item clipped ${width}`)
    assert.equal(await first.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),true)
    await page.keyboard.press('ArrowDown')
    assert.equal(await overlay.evaluate(el=>el.contains(document.activeElement)),true)
    await page.keyboard.press('Escape');await overlay.waitFor({state:'detached'})
    assert.equal(await trigger.evaluate(el=>el===document.activeElement),true)
    await trigger.click();await page.mouse.click(1,height-1);await overlay.waitFor({state:'detached'})
    await trigger.click();await overlay.locator('a[href="/como-funciona"]').click()
    await page.waitForURL(base+'/como-funciona');await overlay.waitFor({state:'detached'})
    await page.locator('.public-header-brand').click();await page.waitForURL(base+'/')
   }
  }
  await page.waitForTimeout(400)
  await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0))
  await page.getByRole('button',{name:'Menu de navegação'}).click()
  await page.screenshot({path:`${folder}/validated/menu-${width}-${theme}.png`})
  await page.keyboard.press('Escape')
  assert.deepEqual(errors,[])
  const metrics=await page.evaluate(()=>({...window.metrics,requests:performance.getEntriesByType('resource').length,transferred:performance.getEntriesByType('resource').reduce((n,e)=>n+e.transferSize,0)}))
  report.layouts.push({width,theme,passed:true,metrics})
  await page.close()
 }
 const page=await browser.newPage({viewport:{width:390,height:844}})
 page.on('request',r=>{
  if(/\/rest\/v1\/exercise_catalog|\/rpc\/get_exercise_catalog_revision/.test(r.url()))report.catalogueReads.push(r.url())
  if(r.url()===base+'/api/public-catalog-snapshot')report.snapshotRequests++
 })
 for(let i=0;i<10;i++) {
  if(i===0)await page.goto(base);else await page.reload()
  await page.locator('[data-catalog-count]').scrollIntoViewIfNeeded()
  await page.getByText('1.234 exercícios publicados',{exact:true}).waitFor()
 }
 const beforeTurbo=report.snapshotRequests
 await page.evaluate(()=>{window.homeTurboProof='preserved'})
 for(let i=0;i<10;i++) {
  await page.locator('footer a[href="/como-funciona"]').click();await page.waitForURL(base+'/como-funciona')
  await page.locator('.public-header-brand').click();await page.waitForURL(base+'/')
  await page.locator('[data-catalog-count]').scrollIntoViewIfNeeded()
  await page.getByText('1.234 exercícios publicados',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.homeTurboProof),'preserved')
  assert.equal(await page.locator('#public-header-menu-root').count(),1)
 }
 assert.equal(beforeTurbo,10,'one snapshot request per visible reload')
 assert.equal(report.snapshotRequests,20,'one snapshot request per Turbo return')
 report.visibleReloadSnapshotRequests=beforeTurbo
 report.visibleTurboSnapshotRequests=report.snapshotRequests-beforeTurbo
 assert.deepEqual(report.catalogueReads,[])
 // Anonymous page remains navigable when the CDN is offline, broken, or stale.
 for(const scenario of ['network','invalid','bad-json','stale']) {
  await page.route('**/api/public-catalog-snapshot',r=>scenario==='network'?r.abort():r.fulfill({status:200,contentType:'application/json',body:scenario==='bad-json'?'bad':JSON.stringify(scenario==='invalid'?{total_active:-1}:{total_active:321,revision:'1',updated_at:'2020-01-01T00:00:00Z'})}))
  await page.reload();await page.locator('[data-catalog-count]').scrollIntoViewIfNeeded()
  if(scenario==='stale')await page.getByText('321 exercícios publicados',{exact:true}).waitFor()
  else {await page.waitForTimeout(250);assert.equal(await page.locator('[data-catalog-count]').textContent(),'Exercícios para sua rotina')}
  assert.equal(await page.locator('main h1').count(),1)
  await page.unroute('**/api/public-catalog-snapshot')
  report.failures.push({scenario,passed:true})
 }
 await page.close()
 const noJs=await browser.newPage({javaScriptEnabled:false});await noJs.goto(base)
 assert.equal(await noJs.locator('[data-catalog-count]').textContent(),'Exercícios para sua rotina')
 assert.equal(await noJs.locator('h1').count(),1);await noJs.close()
 report.passed=true
 writeFileSync(folder+'/browser-results.json',JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report))
}finally{await browser.close()}
