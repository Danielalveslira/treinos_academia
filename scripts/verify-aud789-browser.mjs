// Serve the final build with the exact Vercel CSP: Report-Only first, then enforce.
// Reuses the existing community/mobile fixture suite; all Supabase is intercepted.
import {createServer} from 'node:http'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve,extname} from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'
const config=JSON.parse(readFileSync('vercel.json','utf8'))
const configured=Object.fromEntries(config.headers.find(x=>x.source==='/(.*)').headers.map(x=>[x.key,x.value]))
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'}
const root=resolve('dist')
const remote=process.argv[2]
let mode='report'
const server=remote?null:createServer((req,res)=>{
 const path=new URL(req.url,'http://local').pathname
 let file=resolve(root,`.${path==='/'?'/index.html':path}`)
 if(!file.startsWith(root+'/'))return res.writeHead(403).end()
 let bytes
 try{bytes=readFileSync(file)}catch{if(extname(file))return res.writeHead(404).end();file=resolve(root,'index.html');bytes=readFileSync(file)}
 const headers={...configured,'Content-Type':mime[extname(file)]||'application/octet-stream'}
 if(mode==='report'){headers['Content-Security-Policy-Report-Only']=headers['Content-Security-Policy'];delete headers['Content-Security-Policy']}
 res.writeHead(200,headers).end(bytes)
})
if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=remote??`http://127.0.0.1:${server.address().port}`
if(remote)assert.match(remote,/^https:\/\/treinosacademia-[a-z0-9-]+\.vercel\.app$/)
let childSource=readFileSync('scripts/verify-push-comment-production.mjs','utf8')
childSource=childSource.replace('[320, 360, 390, 430]','[320, 360, 390, 430, 1280]')
childSource=childSource.replace("from 'playwright-core'",`from '${resolve('node_modules/playwright-core/index.mjs')}'`)
childSource=childSource.replace('const errors = []',`const errors = []
      await page.addInitScript(() => {
        window.__policyErrors = []
        document.addEventListener('securitypolicyviolation', e => window.__policyErrors.push({directive:e.effectiveDirective,blocked:e.blockedURI}))
      })`)
childSource=childSource.replace('assert.deepEqual(errors, [])',`assert.deepEqual(errors, [])
      assert.deepEqual(await page.evaluate(() => window.__policyErrors), [])`)
writeFileSync('/tmp/aud789/community-csp-fixture.mjs',childSource)
const results=[]
try{
 for(const next of remote?['enforce']:['report','enforce']){
  mode=next
  const child=spawn(process.execPath,['/tmp/aud789/community-csp-fixture.mjs',origin],{stdio:['ignore','pipe','pipe']})
  let output='';let errors=''
  child.stdout.on('data',x=>{output+=x});child.stderr.on('data',x=>{errors+=x})
  const [code]=await once(child,'close')
  assert.equal(code,0,errors)
  console.log(`PASS ${mode}: 10 community/mobile/desktop/theme cases; zero CSP violations`)
  results.push({mode,communityCases:10,cspViolations:0})
 }
 // Auth screens and real service worker installation, with no production account.
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}})
  await context.route('**/*.supabase.co/**',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}))
  const page=await context.newPage()
  await page.addInitScript(()=>{window.__policyErrors=[];document.addEventListener('securitypolicyviolation',e=>window.__policyErrors.push(e.effectiveDirective))})
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message))
  for(const path of ['/login','/cadastro','/esqueci-senha']){
   const r=await page.goto(origin+path,{waitUntil:'networkidle'})
   assert.equal(r.status(),200)
   assert.deepEqual(await page.evaluate(()=>window.__policyErrors),[])
   assert.ok(await page.locator('#root').textContent())
  }
  await page.goto(origin+'/login',{waitUntil:'networkidle'})
  // The login screen does not mount authenticated PwaControls. Register explicitly
  // to exercise CSP, worker MIME, shell precache and both new external boot files.
  assert.ok(await page.evaluate(async()=>{
   await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'})
   const r=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('service worker activation timeout')),15000))])
   return !!r.active
  }))
  assert.deepEqual(pageErrors,[])
  // A deliberate injection is checked separately from normal operation.
  await page.evaluate(()=>{window.__injected=false;const s=document.createElement('script');s.textContent='window.__injected=true';document.body.append(s)})
  await page.waitForFunction(()=>window.__policyErrors.includes('script-src-elem'))
  assert.equal(await page.evaluate(()=>window.__injected),false)
  results.push({authScreens:3,serviceWorker:true,pageErrors:0,cspViolations:0,injectedInlineScriptBlocked:true})
 }finally{await browser.close()}
 writeFileSync('/tmp/aud789/browser-results.json',JSON.stringify({origin,fixturesOnly:true,results},null,2)+'\n')
}finally{if(server)await new Promise(r=>server.close(r))}
