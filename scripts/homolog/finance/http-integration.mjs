import { runtime } from './prepare-runtime.mjs'
import { waitReady } from './wait-ready.mjs'
import assert from 'node:assert/strict'
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
const config=JSON.parse(readFileSync(runtime+'/local.json','utf8'))
assert.equal(config.url,'http://127.0.0.1:55454')
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
const admin=createClient(config.url,config.service,options)
const client=()=>createClient(config.url,config.anon,options)
const performanceNow=()=>globalThis.performance.now()
const results=[]
const performance=[]
async function check(name,fn){await fn();results.push({name,passed:true});console.log('PASS '+name)}
async function createUser(){
 const email=randomUUID()+'@example.invalid',password='Local-test-password-2026!'
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(error)
 const c=client();const login=await c.auth.signInWithPassword({email,password});assert.ifError(login.error)
 return {id:data.user.id,email,password,c,token:login.data.session.access_token}
}
async function edge(name,token,body){
 const response=await fetch(config.url+'/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(40000)})
 return {status:response.status,body:await response.json()}
}
async function fixture(body){const r=await fetch(config.url+'/__provider/config',{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200)}
async function wallet(c){const {data,error}=await c.rpc('get_my_wallet');assert.ifError(error);return data}
await waitReady()
const a=await createUser(),b=await createUser();let purchase
await check('real Auth issues session_id and financial RPC accepts active session',async()=>{
 assert.ok(JSON.parse(Buffer.from(a.token.split('.')[1],'base64url')).session_id)
 assert.equal((await wallet(a.c)).cash_balance,0)
 assert.ifError((await a.c.rpc('sync_workout_mutations',{p_mutations:[]})).error)
})
await check('real Edge rejects missing auth; direct wallet/RPC mutation denied',async()=>{
 assert.equal((await edge('infinitepay-create-checkout',null,{packageId:'pack_25'})).status,401)
 const update=await a.c.from('wallets').update({cash_balance:999}).eq('user_id',a.id);assert.ok(update.error)
 assert.equal((await edge('infinitepay-admin-reconcile',a.token,{mode:'batch',limit:2})).status,403)
 const upload=await a.c.storage.from('exercise-visuals').upload('forbidden/'+randomUUID()+'.webp',new Uint8Array([82,73,70,70]),{contentType:'image/webp'});assert.ok(upload.error)
 const internal=await a.c.rpc('_wallet_credit_cash',{p_user_id:a.id,p_amount:999});assert.ok(internal.error)
 assert.equal((await wallet(a.c)).cash_balance,0)
})
await check('real Edge reserves server-priced checkout and safely reuses it',async()=>{
 const r=await edge('infinitepay-create-checkout',a.token,{packageId:'pack_25'});assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(r.body.checkoutUrl.startsWith('https://checkout.infinitepay.io/'))
 const p=await admin.from('cash_purchases').select('*').eq('id',r.body.id).single();assert.ifError(p.error);purchase=p.data
 assert.equal(purchase.cash_amount,25);assert.equal(purchase.amount_centavos,590)
 const replay=await edge('infinitepay-create-checkout',a.token,{packageId:'pack_25'});assert.equal(replay.body.id,purchase.id)
 assert.equal((await wallet(a.c)).cash_balance,0)
})
const hint={order_nsu:()=>purchase.provider_order_nsu,transaction_nsu:'txn-'+randomUUID(),invoice_slug:'inv-'+randomUUID()}
const hintBody=()=>({order_nsu:hint.order_nsu(),transaction_nsu:hint.transaction_nsu,invoice_slug:hint.invoice_slug})
await check('browser request cannot check another account purchase or fabricate credit',async()=>{
 const r=await edge('infinitepay-check-payment',b.token,{purchaseId:purchase.id,...hintBody()});assert.equal(r.status,404)
 const falseWebhook=await edge('infinitepay-webhook',null,hintBody());assert.equal(falseWebhook.status,400)
 assert.equal((await wallet(a.c)).cash_balance,0)
})
// The first unpaid check holds a durable cooldown; respect it without modifying database clocks.
writeFileSync(runtime+'/http-pending.json',JSON.stringify({user:a.id,purchase:purchase.id,hint:hintBody()}))
await fixture({order_nsu:purchase.provider_order_nsu,transaction_nsu:hint.transaction_nsu,slug:hint.invoice_slug,paid:true,amount:590})
// Respect the actual persistent call budget instead of bypassing it in the HTTP path.
await new Promise(r=>setTimeout(r,31000))
await check('100 webhook deliveries: one verified credit, ledger and wallet agree',async()=>{
 const outcomes=[]
 for (const [concurrency,requests] of [[1,8],[2,24],[4,68]]) {
  const latencies=[],start=performanceNow()
  for(let sent=0;sent<requests;sent+=concurrency) {
   outcomes.push(...await Promise.all(Array.from({length:Math.min(concurrency,requests-sent)},async()=>{
    const begin=performanceNow();const result=await edge('infinitepay-webhook',null,hintBody());latencies.push(performanceNow()-begin);return result
   })))
  }
  latencies.sort((a,b)=>a-b)
  const percentile=q=>Number(latencies[Math.max(0,Math.ceil(latencies.length*q)-1)].toFixed(2))
  performance.push({concurrency,requests,p50_ms:percentile(.5),p95_ms:percentile(.95),p99_ms:percentile(.99),requests_per_second:Number((requests*1000/(performanceNow()-start)).toFixed(2))})
 }
 assert.ok(outcomes.every(r=>[200,400].includes(r.status)),JSON.stringify(outcomes.filter(r=>![200,400].includes(r.status))))
 assert.ok(outcomes.some(r=>r.status===200));assert.equal((await wallet(a.c)).cash_balance,25)
 const ledger=await admin.from('economy_transactions').select('amount').eq('user_id',a.id).eq('natural_key','cash-purchase:'+purchase.id);assert.ifError(ledger.error);assert.equal(ledger.data.length,1)
})
await check('second real Auth session revokes the first, stale JWT cannot spend/read/sync',async()=>{
 const second=client();assert.ifError((await second.auth.signInWithPassword({email:a.email,password:a.password})).error)
 assert.ifError((await second.auth.signOut({scope:'others'})).error)
 // Keep original JWT explicitly: the SDK's refresh/cache cannot mask the negative proof.
 const stale=createClient(config.url,config.anon,{...options,global:{headers:{Authorization:'Bearer '+a.token}}})
 const read=await stale.rpc('get_my_wallet');assert.equal(read.error?.message,'SESSION_REVOKED')
 const activity=await stale.rpc('register_qualified_activity');assert.ok(activity.error)
 const sync=await stale.rpc('sync_workout_mutations',{p_mutations:[]});assert.equal(sync.error?.message,'SESSION_REVOKED')
 const direct=await stale.from('wallets').select('*');assert.ifError(direct.error);assert.deepEqual(direct.data,[])
 assert.equal((await wallet(second)).cash_balance,25)
})
await check('provider mismatch, outage and timeout never grant cash',async()=>{
 for(const scenario of [{name:'amount',amount:591},{name:'currency',currency:'USD'},{name:'outage',httpStatus:503},{name:'timeout',delayMs:13000}]) {
  const user=await createUser()
  const checkout=await edge('infinitepay-create-checkout',user.token,{packageId:'pack_25'});assert.equal(checkout.status,200)
  const {data:p,error}=await admin.from('cash_purchases').select('*').eq('id',checkout.body.id).single();assert.ifError(error)
  const identity={order_nsu:p.provider_order_nsu,transaction_nsu:'txn-'+randomUUID(),invoice_slug:'inv-'+randomUUID()}
  await fixture({order_nsu:identity.order_nsu,transaction_nsu:identity.transaction_nsu,slug:identity.invoice_slug,paid:true,amount:590,...scenario})
  assert.equal((await edge('infinitepay-webhook',null,identity)).status,400,scenario.name)
  assert.equal((await wallet(user.c)).cash_balance,0,scenario.name)
  const ledger=await admin.from('economy_transactions').select('id').eq('user_id',user.id);assert.ifError(ledger.error);assert.equal(ledger.data.length,0)
 }
})
await check('locally cancelled checkout accepts verified late payment exactly once',async()=>{
 const user=await createUser()
 const checkout=await edge('infinitepay-create-checkout',user.token,{packageId:'pack_25'});assert.equal(checkout.status,200)
 assert.ifError((await user.c.rpc('cancel_my_cash_purchase',{p_purchase_id:checkout.body.id})).error)
 const {data:p,error}=await admin.from('cash_purchases').select('*').eq('id',checkout.body.id).single();assert.ifError(error);assert.equal(p.status,'cancelled')
 const identity={order_nsu:p.provider_order_nsu,transaction_nsu:'txn-'+randomUUID(),invoice_slug:'inv-'+randomUUID()}
 await fixture({order_nsu:identity.order_nsu,transaction_nsu:identity.transaction_nsu,slug:identity.invoice_slug,paid:true,amount:590})
 for(let i=0;i<2;i++)assert.equal((await edge('infinitepay-webhook',null,identity)).status,200)
 assert.equal((await wallet(user.c)).cash_balance,25)
 const ledger=await admin.from('economy_transactions').select('amount').eq('user_id',user.id);assert.ifError(ledger.error);assert.equal(ledger.data.length,1)
})
mkdirSync('docs/audits/finance-integration',{recursive:true})
writeFileSync('docs/audits/finance-integration/http-results.json',JSON.stringify({localOnly:true,realServices:['Auth','PostgreSQL','PostgREST','Storage','Edge Runtime'],provider:'local simulated responses; external payment network blocked',performance,results},null,2)+'\n')
console.log(JSON.stringify({passed:results.length,failed:0}))
