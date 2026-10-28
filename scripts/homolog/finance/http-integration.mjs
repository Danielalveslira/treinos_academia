import { runtime } from './prepare-runtime.mjs'
import { waitReady } from './wait-ready.mjs'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
const config=JSON.parse(readFileSync(runtime+'/local.json','utf8'))
config.url=process.env.FINANCE_HTTP_URL||config.url
assert.ok(['http://127.0.0.1:55454','http://127.0.0.1:55554'].includes(config.url))
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
 // Synthetic users must satisfy the current legal/onboarding gate, just like
 // the browser fixtures. Never remove the application access checks for tests.
 assert.match(data.user.id, /^[0-9a-f-]{36}$/)
 const db=config.url.endsWith(':55554')?'evolutus_price_phase1_db':'evolutus_integrated_db'
 execFileSync('docker',['exec',db,'psql','-U','supabase_admin','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',`update public.users set usage_profile='professional',username='http_'||left(replace(id::text,'-',''),12),legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id),legal_acceptance_accepted_at=now() where id='${data.user.id}';`],{stdio:'pipe'})
 return {id:data.user.id,email,password,c,token:login.data.session.access_token}
}
async function edge(name,token,body){
 const response=await fetch(config.url+'/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(40000)})
 return {status:response.status,body:await response.json()}
}
async function fixture(body){const r=await fetch(config.url+'/__provider/config',{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200)}
async function wallet(c){const {data,error}=await c.rpc('get_my_wallet');assert.ifError(error);return data}
await waitReady(config.url)
const container=config.url.endsWith(':55554')?'evolutus_price_phase1_db':'evolutus_integrated_db'
const pricingAdmin=await createUser()
execFileSync('docker',['exec',container,'psql','-U','supabase_admin','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',`update public.users set role='superadmin' where id='${pricingAdmin.id}';update public.evocash_pricing_state set quoting_enabled=true,checkout_enabled=true where id;`],{stdio:'pipe'})
const initial=await pricingAdmin.c.rpc('admin_get_evocash_pricing');assert.ifError(initial.error)
const setup=await pricingAdmin.c.rpc('admin_publish_evocash_price',{p_config:{unitPriceCentavos:'10',minimumUnitPriceCentavos:'1',minQuantity:'1',maxQuantity:'1000',dailyQuantityLimit:'2000',totalQuantityLimit:'10000',quoteTtlSeconds:'300',largeChangeThresholdBps:'2000'},p_active_from:null,p_expected_revision:initial.data.revision,p_request_id:randomUUID(),p_reason:'Synthetic phase 2 HTTP verification',p_confirm_large_change:true});assert.ifError(setup.error)
const intents=new Map()
async function quantityCheckout(user){
 let intent=intents.get(user.id)
 if(!intent){
  const q=await user.c.rpc('create_evocash_purchase_quote',{p_quantity:'25',p_request_id:randomUUID()});assert.ifError(q.error)
  intent={quoteId:q.data.quoteId,requestId:randomUUID()};intents.set(user.id,intent)
 }
 return edge('infinitepay-create-checkout',user.token,intent)
}
const a=await createUser(),b=await createUser();let purchase
await check('real Auth issues session_id and financial RPC accepts active session',async()=>{
 assert.ok(JSON.parse(Buffer.from(a.token.split('.')[1],'base64url')).session_id)
 assert.equal((await wallet(a.c)).cash_balance,0)
 assert.ifError((await a.c.rpc('sync_workout_mutations',{p_mutations:[]})).error)
})
await check('real Edge rejects missing auth; direct wallet/RPC mutation denied',async()=>{
 assert.equal((await edge('infinitepay-create-checkout',null,{quoteId:randomUUID(),requestId:randomUUID()})).status,401)
 const update=await a.c.from('wallets').update({cash_balance:999}).eq('user_id',a.id);assert.ok(update.error)
 assert.equal((await edge('infinitepay-admin-reconcile',a.token,{mode:'batch',limit:2})).status,403)
 const upload=await a.c.storage.from('exercise-visuals').upload('forbidden/'+randomUUID()+'.webp',new Uint8Array([82,73,70,70]),{contentType:'image/webp'});assert.ok(upload.error)
 const internal=await a.c.rpc('_wallet_credit_cash',{p_user_id:a.id,p_amount:999});assert.ok(internal.error)
 assert.equal((await wallet(a.c)).cash_balance,0)
})
await check('real Edge reserves server-priced checkout and safely reuses it',async()=>{
 const r=await quantityCheckout(a);assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(r.body.checkoutUrl.startsWith('https://checkout.infinitepay.io/'))
 const p=await admin.from('cash_purchases').select('*').eq('id',r.body.id).single();assert.ifError(p.error);purchase=p.data
 assert.equal(purchase.cash_amount,25);assert.equal(purchase.amount_centavos,250)
 const replay=await quantityCheckout(a);assert.equal(replay.body.id,purchase.id)
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
await fixture({order_nsu:purchase.provider_order_nsu,transaction_nsu:hint.transaction_nsu,slug:hint.invoice_slug,paid:true,amount:250})
// Respect the actual persistent call budget instead of bypassing it in the HTTP path.
await new Promise(r=>setTimeout(r,31000))
await check('12 webhook deliveries: one verified credit, ledger and wallet agree',async()=>{
 const outcomes=[]
 for (const [concurrency,requests] of [[1,2],[2,4],[4,6]]) {
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
 for(const scenario of [{name:'amount',amount:251},{name:'currency',currency:'USD'},{name:'outage',httpStatus:503},{name:'timeout',delayMs:13000}]) {
  const user=await createUser()
  const checkout=await quantityCheckout(user);assert.equal(checkout.status,200)
  const {data:p,error}=await admin.from('cash_purchases').select('*').eq('id',checkout.body.id).single();assert.ifError(error)
  const identity={order_nsu:p.provider_order_nsu,transaction_nsu:'txn-'+randomUUID(),invoice_slug:'inv-'+randomUUID()}
  await fixture({order_nsu:identity.order_nsu,transaction_nsu:identity.transaction_nsu,slug:identity.invoice_slug,paid:true,amount:250,...scenario})
  assert.equal((await edge('infinitepay-webhook',null,identity)).status,400,scenario.name)
  assert.equal((await wallet(user.c)).cash_balance,0,scenario.name)
  const ledger=await admin.from('economy_transactions').select('id').eq('user_id',user.id);assert.ifError(ledger.error);assert.equal(ledger.data.length,0)
 }
})
await check('locally cancelled checkout accepts verified late payment exactly once',async()=>{
 const user=await createUser()
 const checkout=await quantityCheckout(user);assert.equal(checkout.status,200)
 assert.ifError((await user.c.rpc('cancel_my_cash_purchase',{p_purchase_id:checkout.body.id})).error)
 const {data:p,error}=await admin.from('cash_purchases').select('*').eq('id',checkout.body.id).single();assert.ifError(error);assert.equal(p.status,'cancelled')
 const identity={order_nsu:p.provider_order_nsu,transaction_nsu:'txn-'+randomUUID(),invoice_slug:'inv-'+randomUUID()}
 await fixture({order_nsu:identity.order_nsu,transaction_nsu:identity.transaction_nsu,slug:identity.invoice_slug,paid:true,amount:250})
 for(let i=0;i<2;i++)assert.equal((await edge('infinitepay-webhook',null,identity)).status,200)
 assert.equal((await wallet(user.c)).cash_balance,25)
 const ledger=await admin.from('economy_transactions').select('amount').eq('user_id',user.id);assert.ifError(ledger.error);assert.equal(ledger.data.length,1)
})
mkdirSync('docs/finance-restructure/phase2/evidence',{recursive:true})
writeFileSync('docs/finance-restructure/phase2/evidence/http-results.json',JSON.stringify({localOnly:true,realServices:['Auth','PostgreSQL','PostgREST','Storage','Edge Runtime'],provider:'local simulated responses; external payment network blocked',performance,results},null,2)+'\n')
console.log(JSON.stringify({passed:results.length,failed:0}))
