import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import handler from '../api/public-catalog-snapshot.js'

const value={total_active:867,revision:'42',updated_at:'2026-10-27T00:00:00Z'}
function response() {
 return {headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}}
}
test('endpoint reads only the precomputed singleton, caches public JSON and leaks no extras', async()=>{
 const original=global.fetch
 const originalEnv={...process.env}
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_ANON_KEY='anonymous-key'
 try {
  const calls=[]
  global.fetch=async(url,options)=>{calls.push({url:String(url),options});return {ok:true,json:async()=>[{...value,secret:'never-return'}]}}
  for (const method of ['GET','HEAD']) {
   const res=response();await handler({method},res)
   assert.equal(res.statusCode,200)
   assert.equal(res.headers['Vercel-CDN-Cache-Control'],'public, s-maxage=60, must-revalidate')
   assert.equal(res.headers['Cache-Control'],'public, max-age=0, must-revalidate')
   if(method==='GET')assert.deepEqual(JSON.parse(res.body),value);else assert.equal(res.body,undefined)
  }
  assert.ok(calls.every(c=>c.url.includes('/rest/v1/public_catalog_snapshot?')&&!c.url.includes('/rpc/')))
  assert.ok(calls.every(c=>c.options.headers.apikey==='anonymous-key'))
 }finally{global.fetch=original;process.env=originalEnv}
})
test('endpoint denies mutation and returns uncached neutral errors for bad JSON/origin/config',async()=>{
 const original=global.fetch, originalEnv={...process.env}
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_ANON_KEY='anonymous-key'
 try {
  global.fetch=()=>{throw Error('must not read')}
  for(const method of ['POST','PATCH','DELETE','PUT']){const res=response();await handler({method},res);assert.equal(res.statusCode,405)}
  for(const bad of [[],[{}],[{...value,total_active:-1}],[{...value,total_active:1.5}],[{...value,revision:'payload'}],[{...value,updated_at:'bad'}],[value,value]]) {
   global.fetch=async()=>({ok:true,json:async()=>bad});const res=response();await handler({method:'GET'},res)
   assert.equal(res.statusCode,503);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.body,'{"unavailable":true}')
  }
  global.fetch=async()=>{throw Error('private-key')};const res=response();await handler({method:'GET'},res);assert.equal(res.body.includes('private'),false)
 }finally{global.fetch=original;process.env=originalEnv}
})

function client(payload=value,{ok=true,fail=false}={}) {
 const listeners=new Map(), calls=[],observed=[],target={textContent:'Exercícios para sua rotina',isConnected:true}
 const doc={readyState:'complete',querySelector:()=>target,addEventListener(name,fn){listeners.set(name,fn)}}
 const context={window:{},document:doc,Intl,Date,Number,AbortController,IntersectionObserver:class {
  constructor(callback){this.callback=callback;observed.push(this)}observe(){}disconnect(){this.disconnected=true}
 },fetch:async(...args)=>{calls.push(args);if(fail)throw Error('offline');return {ok,json:async()=>payload}}}
 const source=readFileSync('public/public-catalog-count.js','utf8')
 context.window.IntersectionObserver=context.IntersectionObserver
 vm.runInNewContext(source,context)
 return {context,source,target,listeners,calls,observed,show:()=>observed.at(-1).callback([{isIntersecting:true}])}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('client is lazy, mounts once, formats real zero and counts, aborts on Turbo cache',async()=>{
 const c=client();assert.equal(c.calls.length,0)
 c.listeners.get('turbo:load')();assert.equal(c.observed.length,1)
 vm.runInNewContext(c.source,c.context);assert.equal(c.observed.length,1)
 c.show();c.show();await flush();assert.equal(c.calls.length,1);assert.equal(c.target.textContent,'867 exercícios publicados')
 c.listeners.get('turbo:before-cache')();assert.equal(c.calls[0][1].signal.aborted,true);assert.equal(c.target.textContent,'Exercícios para sua rotina')
 c.listeners.get('turbo:load')();c.show();await flush();assert.equal(c.calls.length,2)
 const zero=client({...value,total_active:0});zero.show();await flush();assert.equal(zero.target.textContent,'0 exercícios publicados')
})
test('client preserves neutral HTML on offline, bad JSON, invalid totals/revision/date; old unchanged snapshot is valid',async()=>{
 for(const payload of [null,{}, {...value,total_active:'867'},{...value,total_active:-1},{...value,total_active:NaN},{...value,total_active:Number.MAX_SAFE_INTEGER+1},{...value,revision:''},{...value,updated_at:'bad'},{...value,updated_at:'2999-01-01T00:00:00Z'}]) {
  const c=client(payload);c.show();await flush();assert.equal(c.target.textContent,'Exercícios para sua rotina')
 }
 for(const options of [{ok:false},{fail:true}]){const c=client(value,options);c.show();await flush();assert.equal(c.target.textContent,'Exercícios para sua rotina')}
 const c=client({...value,updated_at:'2020-01-01T00:00:00Z'});c.show();await flush();assert.equal(c.target.textContent,'867 exercícios publicados')
})
