// Lab-only comparison, not field Core Web Vitals. One browser, serial cold contexts.
import {chromium} from 'playwright-core'
import {writeFileSync,readFileSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/tmp/pr84-release-browser/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']})
const measurements=[]
try{
 for(const width of [390,1440])for(const phase of ['before','after'])for(let sample=0;sample<3;sample++) {
  const page=await browser.newPage({viewport:{width,height:900}})
  const session=await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate',{rate:4})
  await session.send('Network.enable')
  await session.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1500000,uploadThroughput:750000})
  await page.addInitScript(()=>{
   window.lab={cls:0,lcp:0,eventDurations:[]}
   new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.lab.cls+=e.value}).observe({type:'layout-shift',buffered:true})
   new PerformanceObserver(list=>{for(const e of list.getEntries())window.lab.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true})
   new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.interactionId)window.lab.eventDurations.push(e.duration)}).observe({type:'event',buffered:true,durationThreshold:16})
  })
  await page.goto(`http://127.0.0.1:${phase==='before'?4175:4174}/`,{waitUntil:'networkidle'})
  const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>({url:new URL(e.name).pathname,bytes:e.transferSize})))
  const trigger=page.getByRole('button',{name:'Menu de navegação'})
  await trigger.click();await page.locator('.public-header-overlay').waitFor();await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const metrics=await page.evaluate(()=>window.lab)
  measurements.push({phase,width,sample,metrics,initialRequests:resources.length,initialTransferredBytes:resources.reduce((n,e)=>n+e.bytes,0),resources})
  await page.close()
 }
 const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]
 const summary=[]
 for(const width of [390,1440])for(const phase of ['before','after']){
  const rows=measurements.filter(x=>x.width===width&&x.phase===phase)
  summary.push({width,phase,lcpMedianMs:median(rows.map(x=>x.metrics.lcp)),clsMax:Math.max(...rows.map(x=>x.metrics.cls)),maxObservedEventDurationMs:Math.max(0,...rows.flatMap(x=>x.metrics.eventDurations)),initialRequests:rows[0].initialRequests,initialTransferredBytes:rows[0].initialTransferredBytes})
 }
 const result={labOnly:true,fieldINPMeasured:false,cpuSlowdown:4,latencyMs:40,downloadBytesPerSecond:1500000,samplesPerCase:3,standaloneCounterGzipBytes:gzipSync(readFileSync('public/public-catalog-count.js')).length,summary,measurements}
 writeFileSync('docs/public-home-v2-evidence/performance.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({summary,standaloneCounterGzipBytes:result.standaloneCounterGzipBytes}))
}finally{await browser.close()}
