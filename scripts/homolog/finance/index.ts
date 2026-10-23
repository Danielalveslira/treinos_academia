// LOCAL HARNESS ONLY. Never copied/deployed into supabase/functions.
const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(Deno.env.get('JWT_SECRET')!),{name:'HMAC',hash:'SHA-256'},false,['verify'])
const decode = (s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0))
async function valid(token:string) {
 try {
  const [h,p,s]=token.split('.')
  const payload=JSON.parse(new TextDecoder().decode(decode(p)))
  return payload.exp>Date.now()/1000 && await crypto.subtle.verify('HMAC',key,decode(s),new TextEncoder().encode(`${h}.${p}`))
 } catch { return false }
}
const fixtures=new Map<string,Record<string,unknown>>()
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}})
Deno.serve(async(req:Request)=>{
 const url=new URL(req.url)
 if(req.method==='OPTIONS')return new Response('ok',{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'}})
 if(url.pathname==='/__health')return json({local:true})
 if(url.pathname==='/__provider/config') {
  const body=await req.json(); fixtures.set(body.order_nsu,body); return json({ok:true})
 }
 if(url.pathname.startsWith('/__provider/')) {
  const body=await req.json(); const fixture=fixtures.get(body.order_nsu)
  if(url.pathname.endsWith('/links')) return fixture?.failLinks ? json({code:'TEST_REJECTION'},422) : json({url:`https://checkout.infinitepay.io/fixture?lenc=${body.order_nsu}`})
  if(!fixture)return json({success:true,paid:false})
  if(fixture.httpStatus)return json({error:'fixture'},Number(fixture.httpStatus))
  if(fixture.delayMs)await new Promise(r=>setTimeout(r,Number(fixture.delayMs)))
  if(fixture.transaction_nsu!==body.transaction_nsu || fixture.slug!==body.slug)return json({success:false,paid:false})
  return json({success:true,paid:fixture.paid===true,amount:fixture.amount,capture_method:fixture.capture_method||'pix',...(fixture.currency?{currency:fixture.currency}:{})})
 }
 const prefix=['/auth/v1','/rest/v1','/storage/v1'].find(p=>url.pathname.startsWith(p))
 if(prefix) {
  const port=prefix==='/auth/v1'?9999:prefix==='/rest/v1'?3000:5000
  const upstream=`http://127.0.0.1:${port}${url.pathname.slice(prefix.length)||'/'}${url.search}`
  return fetch(new Request(upstream,req))
 }
 const name=url.pathname.replace(/^\/functions\/v1\//,'').split('/')[0]
 if(!/^[a-z0-9-]+$/.test(name))return json({error:'NOT_FOUND'},404)
 if(name!=='infinitepay-webhook' && !await valid((req.headers.get('Authorization')||'').replace(/^Bearer /,'')))return json({error:'NOT_AUTHENTICATED'},401)
 try {
  const path=name.startsWith('infinitepay-')?'/home/deno/wrappers/':'/home/deno/functions/'
  const worker=await (globalThis as any).EdgeRuntime.userWorkers.create({servicePath:path+name,memoryLimitMb:128,workerTimeoutMs:60000,noModuleCache:false,importMapPath:null,envVars:Object.entries(Deno.env.toObject()),forceCreate:false,netAccessDisabled:false,cpuTimeSoftLimitMs:10000,cpuTimeHardLimitMs:20000})
  return await worker.fetch(req)
 } catch { return json({error:'LOCAL_WORKER_FAILURE'},500) }
})
