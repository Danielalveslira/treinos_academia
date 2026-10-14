// Fixed production destination; only SELECT and read-only aggregate RPC requests.
// Uses the public frontend key, never an administrative/service-role credential.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const config = Object.fromEntries(readFileSync('.env','utf8').split(/\r?\n/)
  .filter(line=>/^VITE_SUPABASE_(URL|ANON_KEY)=/.test(line))
  .map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1).trim().replace(/^['"]|['"]$/g,'')]}))
const origin='https://ywrjojrjgozdfpddkkuy.supabase.co'
assert.equal(config.VITE_SUPABASE_URL,origin)
assert.ok(config.VITE_SUPABASE_ANON_KEY)
const headers={apikey:config.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${config.VITE_SUPABASE_ANON_KEY}`,'Content-Type':'application/json'}
for(const [path,body] of [
  ['/rest/v1/status_votes?select=status_id&limit=1',null],
  ['/rest/v1/rpc/get_poll_results',{p_status_id:'00000000-0000-0000-0000-000000000000'}],
  ['/rest/v1/rpc/get_poll_results_batch',{p_status_ids:[]}],
]) {
  const r=await fetch(origin+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})})
  const data=await r.json()
  assert.ok(r.status===401||r.status===403,`anonymous protected read ${path}: ${r.status}`)
  assert.equal(data.code,'42501')
  console.log(JSON.stringify({path,status:r.status,code:data.code,denied:true}))
}
console.log('PASS 3 production PostgREST read-only permission checks')
