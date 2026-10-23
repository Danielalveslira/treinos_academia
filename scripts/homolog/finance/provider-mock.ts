// Test workers only: production requests to InfinitePay can never leave this harness.
const actual=globalThis.fetch
const allowed=new Set(['127.0.0.1','localhost'])
globalThis.fetch=(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(input instanceof Request?input.url:String(input))
 if(url.origin==='https://api.checkout.infinitepay.io') {
  return actual(new Request('http://127.0.0.1:9000/__provider'+url.pathname,input instanceof Request?input:init))
 }
 if(url.origin==='https://local-supabase.invalid') {
  return actual(new Request('http://127.0.0.1:9000'+url.pathname+url.search,input instanceof Request?input:init))
 }
 if(!allowed.has(url.hostname))return Promise.reject(new Error('EXTERNAL_NETWORK_BLOCKED_IN_LOCAL_TEST'))
 return actual(input,init)
}
