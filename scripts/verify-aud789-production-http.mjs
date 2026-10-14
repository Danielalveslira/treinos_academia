// Public GETs only. Verify the effective platform headers, MIME and cache contract.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
const origin=process.argv[2]??'https://treinosacademia-ten.vercel.app'
assert.match(origin,/^https:\/\/treinosacademia-[a-z0-9-]+\.vercel\.app$/)
const expected=Object.fromEntries(JSON.parse(readFileSync('vercel.json','utf8')).headers.find(x=>x.source==='/(.*)').headers.map(x=>[x.key.toLowerCase(),x.value]))
const first=await fetch(origin+'/')
const html=await first.text()
const assets=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(x=>x[1]).filter(x=>x.startsWith('/assets/')&&(x.endsWith('.js')||x.endsWith('.css')))
assert.ok(assets.some(x=>x.endsWith('.js'))&&assets.some(x=>x.endsWith('.css')))
const paths=['/','/login','/cadastro','/esqueci-senha','/comunidades/00000000-0000-0000-0000-000000000000','/manifest.webmanifest','/sw.js','/boot-theme.js','/boot-fallback.js','/icons/icon-192.png',...new Set(assets)]
const results=[]
for(const path of paths){
 const r=await fetch(origin+path)
 assert.equal(r.status,200,path)
 for(const [key,value] of Object.entries(expected))assert.equal(r.headers.get(key),value,`${path}: ${key}`)
 assert.match(r.headers.get('strict-transport-security')??'',/max-age=/)
 const cache=r.headers.get('cache-control')??''
 if(path.startsWith('/assets/'))assert.match(cache,/immutable/)
 if(path==='/sw.js'||path.startsWith('/boot-'))assert.match(cache,/no-cache/)
 if(path==='/'||path==='/login')assert.ok(!cache.includes('immutable'))
 const type=r.headers.get('content-type')??''
 if(path.endsWith('.js'))assert.match(type,/javascript/)
 if(path.endsWith('.css'))assert.match(type,/text\/css/)
 results.push({path,status:r.status,cacheControl:cache,contentType:type,securityHeaders:expected})
 await r.arrayBuffer()
}
writeFileSync('/tmp/aud789/http-production.json',JSON.stringify({origin,checks:results.length,results},null,2)+'\n')
console.log(`PASS ${results.length} Vercel public routes/assets: enforced CSP, security headers, MIME and cache`)
