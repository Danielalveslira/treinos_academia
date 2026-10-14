import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const config=JSON.parse(readFileSync('vercel.json','utf8'))
const headers=Object.fromEntries(config.headers.find(x=>x.source==='/(.*)').headers.map(x=>[x.key,x.value]))
test('CSP blocks injected scripts and framing while preserving real API/image/PWA integrations',()=>{
 const csp=headers['Content-Security-Policy']
 assert.match(csp,/script-src 'self';/)
 assert.ok(!csp.includes('unsafe-eval')&&!/script-src[^;]*unsafe-inline/.test(csp)&&!csp.includes('*'))
 for(const rule of ["object-src 'none'","frame-ancestors 'none'","worker-src 'self'","manifest-src 'self'",'https://ywrjojrjgozdfpddkkuy.supabase.co','wss://ywrjojrjgozdfpddkkuy.supabase.co','https://firebasestorage.googleapis.com']) assert.ok(csp.includes(rule),rule)
 assert.equal(headers['X-Content-Type-Options'],'nosniff')
 assert.equal(headers['X-Frame-Options'],'DENY')
 assert.equal(headers['Referrer-Policy'],'strict-origin-when-cross-origin')
 assert.match(config.headers.find(x=>x.source==='/assets/(.*)').headers[0].value,/immutable/)
 assert.equal(config.headers.find(x=>x.source==='/sw.js').headers[0].value,'no-cache')
})
test('HTML has no inline executable script or event handler; external boot is available offline',()=>{
 const html=readFileSync('index.html','utf8')
 assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html))
 assert.ok(!/\bonclick=/.test(html))
 for(const file of ['boot-theme.js','boot-fallback.js']){
  assert.ok(html.includes(`src="/${file}"`))
  assert.ok(readFileSync('scripts/pwa-plugin.js','utf8').includes(`'${file}'`))
  assert.ok(readFileSync(`public/${file}`,'utf8').length>0)
 }
})
