// Explicitly synthetic, fixed loopback stack only. Never a migration or production tariff.
await import('./phase5-seed.mjs')
const{readFileSync,writeFileSync}=await import('node:fs'),{jwt}=await import('../keys.mjs')
const a=JSON.parse(readFileSync('.finance-local/phase5-access.json')),anon=jwt({role:'anon'})
async function rpc(name,args){const r=await fetch('http://127.0.0.1:55554/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+a.admin.access_token,'Content-Type':'application/json'},body:JSON.stringify(args)});const raw=await r.text();const data=raw?JSON.parse(raw):null;if(!r.ok)throw Error(data.message);return data}
for(const kind of ['professional','space']){const row=(await rpc('get_professional_listing_limits',{})).find(l=>l.kind===kind);await rpc('admin_set_professional_listing_limit',{p_kind:kind,p_max:5,p_revision:row?.revision||'0',p_reason:'Configuração estritamente sintética de homologação local'})}
writeFileSync('.finance-local/phase51-access.json',JSON.stringify(a));console.log('Phase 5.1 synthetic owner: '+a.owner.user.email)
