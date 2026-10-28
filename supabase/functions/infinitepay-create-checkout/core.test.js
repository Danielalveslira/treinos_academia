import test from 'node:test'
import assert from 'node:assert/strict'
import { checkoutPayload, createCheckout, validCheckoutUrl } from './core.js'
const quoteId='a1000000-0000-0000-0000-000000000001',requestId='a1000000-0000-0000-0000-000000000002'
const reservation={id:'123',orderNsu:`evo_${'a'.repeat(32)}`,amountCentavos:'590',cashAmount:'59',createLink:true,checkoutValidUntil:'2027-01-01T00:00:00Z'}
function fixtures(overrides={}) {
 const calls=[]
 const reserved=overrides.reserved??reservation
 const userClient={rpc:async(name,args)=>{if(name==='has_app_access')return {data:true};calls.push([name,args]);return {data:reserved}}}
 const admin={rpc:async(name,args)=>{calls.push([name,args]);return {data:null,error:null}}}
 const fetcher=async(_url,options)=>{calls.push(['fetch',JSON.parse(options.body),options.headers]);return Response.json({url:'https://checkout.infinitepay.io/tag?lenc=token'})}
 return {calls,userClient,admin,fetcher,quoteId,requestId,handle:'my-tag',apiKey:'synthetic-test-key',enabled:true,appUrl:'https://app.example',supabaseUrl:'https://local-supabase.invalid',logger:{warn(){},error(){}},...overrides}
}
test('quantity checkout uses quote/session authority, integer cents and mandatory single-payment/expiry',async()=>{
 const d=fixtures();const r=await createCheckout(d)
 assert.equal(r.checkoutUrl,'https://checkout.infinitepay.io/tag?lenc=token')
 assert.deepEqual(d.calls[0],['reserve_infinitepay_cash_purchase',{p_quote_id:quoteId,p_request_id:requestId}])
 assert.deepEqual(d.calls[1][1].items,[{quantity:1,price:590,description:'59 EvoCash'}])
 assert.deepEqual(d.calls[1][1].options,{single_payment:true,valid_until:reservation.checkoutValidUntil})
 assert.equal(d.calls[1][2]['X-Api-Key'],'synthetic-test-key')
 assert.equal(d.calls[2][0],'finish_infinitepay_checkout')
})
test('malformed IDs, paused sales, missing merchant key and invalid origin fail before provider/reservation',async()=>{
 for(const [override,message] of [[{quoteId:'pack_25'},'INVALID_REQUEST'],[{enabled:false},'EVOCASH_PURCHASES_PAUSED'],[{apiKey:null},'INFINITEPAY_NOT_CONFIGURED'],[{appUrl:'http://app.example'},'INFINITEPAY_NOT_CONFIGURED']]) {
  const d=fixtures(override);await assert.rejects(createCheckout(d),new RegExp(message));assert.equal(d.calls.length,0)
 }
 const d=fixtures({userClient:{rpc:async()=>({data:false})}});await assert.rejects(createCheckout(d),/APP_ACCESS_DENIED/)
})
test('replay returns the persisted URL without creating another link',async()=>{
 const d=fixtures({reserved:{id:'123',checkoutUrl:'https://checkout.infinitepay.com.br/a',status:'pending'},fetcher:()=>{throw Error('duplicate link')}})
 assert.equal((await createCheckout(d)).id,'123');assert.equal(d.calls.length,1)
})
test('definitive 4xx records failed checkout; ambiguous responses freeze automatic retry',async()=>{
 const d=fixtures({fetcher:async()=>Response.json({code:'INVALID_HANDLE'},{status:422})})
 await assert.rejects(createCheckout(d),/INFINITEPAY_LINK_FAILED/);assert.equal(d.calls.at(-1)[0],'fail_infinitepay_checkout')
 for(const fetcher of [async()=>Response.json({}, {status:503}),async()=>Response.json({}, {status:408}),async()=>Response.json({}, {status:429}),async()=>Response.json({}),async()=>{throw new DOMException('timeout','TimeoutError')}]) {
  const d=fixtures({fetcher});await assert.rejects(createCheckout(d));assert.equal(d.calls.at(-1)[0],'mark_infinitepay_checkout_uncertain')
 }
})
test('uncertain/in-progress reservation never calls provider',async()=>{
 for(const uncertain of [false,true]){
  const d=fixtures({reserved:{id:'123',createLink:false,uncertain},fetcher:()=>{throw Error('duplicate')}})
  await assert.rejects(createCheckout(d),uncertain?/CHECKOUT_RECONCILIATION_REQUIRED/:/CHECKOUT_IN_PROGRESS/);assert.equal(d.calls.length,1)
 }
})
test('failure to persist a remotely created link freezes order; pre-provider validation can release safely',async()=>{
 const d=fixtures({admin:{rpc:async name=>{d.calls.push([name]);return {error:name==='finish_infinitepay_checkout'?{message:'unavailable'}:null}}}})
 await assert.rejects(createCheckout(d),/CHECKOUT_SAVE_FAILED/);assert.equal(d.calls.at(-1)[0],'mark_infinitepay_checkout_uncertain')
 const invalid=fixtures({reserved:{...reservation,amountCentavos:'NaN'}})
 await assert.rejects(createCheckout(invalid),/INVALID_CHECKOUT_INPUT/);assert.equal(invalid.calls.at(-1)[0],'release_infinitepay_checkout')
})
test('persisted and returned checkout URLs share a strict HTTPS allowlist',async()=>{
 assert.ok(validCheckoutUrl('https://checkout.infinitepay.io/a'))
 for(const url of ['http://checkout.infinitepay.io/','https://evil.test/','https://checkout.infinitepay.io.evil.test/','https://user@checkout.infinitepay.io/','https://checkout.infinitepay.io:4433/']){
  assert.equal(validCheckoutUrl(url),false)
  const d=fixtures({reserved:{checkoutUrl:url}});await assert.rejects(createCheckout(d),/INVALID_CHECKOUT_URL/)
 }
 assert.throws(()=>checkoutPayload({handle:'x',orderNsu:reservation.orderNsu,amountCentavos:590}),/INVALID_CHECKOUT_INPUT/)
})
