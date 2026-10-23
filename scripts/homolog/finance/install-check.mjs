// Clean install + populated incremental upgrade on a fixed disposable database.
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { SECRET } from '../keys.mjs'
import { createHash, randomUUID } from 'node:crypto'
const db='evolutus_integrated_clean_db'
const root=new URL('../../../',import.meta.url).pathname.replace(/\/$/,'')
const logs=root+'/.finance-local/logs/install'
mkdirSync(logs,{recursive:true})
const run=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024})
const sql=s=>run(['exec','-i',db,'psql','-U','supabase_admin','-d','postgres','-X','-tA','-v','ON_ERROR_STOP=1'],s).trim()
try {run(['inspect',db]);throw new Error('Refusing to overwrite an existing clean container')} catch(e){if(e.message.startsWith('Refusing'))throw e}
const startDatabase=()=>run(['run','-d','--name',db,'--cpus','0.5','--memory','900m','--memory-swap','1800m','-v',root+':/workspace:ro','-e','POSTGRES_PASSWORD=integrated-local-synthetic-password','public.ecr.aws/supabase/postgres:17.6.1.166'])
async function ready(fn){for(let i=0;i<90;i++){try{if(fn())return}catch{/* starting */}await new Promise(r=>setTimeout(r,500))}throw new Error('clean service startup timeout')}
startDatabase()
await ready(()=>run(['exec',db,'pg_isready','-h','127.0.0.1','-U','supabase_admin']).includes('accepting'))
sql("alter system set cron.launch_active_jobs=off;")
sql("select pg_reload_conf();")
const sidecars=[]
try {
 for(const suffix of ['auth','storage']) {
  const original=JSON.parse(run(['inspect','evolutus_integrated_'+suffix]))[0]
  const env=Object.fromEntries(original.Config.Env.map(value=>{const at=value.indexOf('=');return [value.slice(0,at),value.slice(at+1)]}))
  const connection=new URL(env[suffix==='auth'?'GOTRUE_DB_DATABASE_URL':'DATABASE_URL'])
  const expectedImage='public.ecr.aws/supabase/'+(suffix==='auth'?'gotrue:v2.197.0':'storage-api:v1.77.5')
  if(original.Config.Image!==expectedImage || !['postgres:','postgresql:'].includes(connection.protocol) || connection.hostname!=='127.0.0.1' || connection.port!=='5432' || connection.pathname!=='/postgres' || connection.password!=='integrated-local-synthetic-password' || env[suffix==='auth'?'GOTRUE_JWT_SECRET':'AUTH_JWT_SECRET']!==SECRET) throw new Error('Refusing non-synthetic service configuration')
  const name='evolutus_integrated_clean_'+suffix;sidecars.push(name)
  run(['run','-d','--name',name,'--network','container:'+db,'--cpus','0.2','--memory','240m',...original.Config.Env.flatMap(e=>['-e',e]),original.Config.Image])
 }
 await ready(()=>sql("select to_regclass('auth.sessions') is not null and exists(select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='metadata')")==='t')
 // Wait until both services finish their migrations, then stop before snapshot.
 await ready(()=>run(['exec',sidecars[1],'node','-e',"Promise.all([fetch('http://127.0.0.1:5000/status'),fetch('http://127.0.0.1:9999/health')]).then(r=>process.exit(r.every(x=>x.ok)?0:1)).catch(()=>process.exit(1))"])==='')
 for(const n of sidecars)run(['stop',n])
 sql('create extension if not exists pg_cron; create extension if not exists pgtap with schema extensions;')
 const baseline=run(['exec',db,'pg_dump','-U','supabase_admin','-d','postgres','--schema=auth','--schema=storage','--clean','--if-exists'])
 writeFileSync(logs+'/services-only.sql',baseline)
 const migrate=mode=>{const out=execFileSync(process.execPath,[root+'/scripts/homolog/finance/migrate.mjs',mode,db],{encoding:'utf8',maxBuffer:4*1024*1024});writeFileSync(logs+'/'+mode+'.log',out);console.log(out.trim())}
 migrate('all')
 const contract=readFileSync(root+'/scripts/homolog/finance-schema-contract.sql','utf8')
 const clean=JSON.parse(sql(contract))
 writeFileSync(logs+'/clean-contract.json',JSON.stringify(clean,null,2))
 // Restore only this task's disposable DB to the actual Auth/Storage service baseline.
 run(['rm','-f',db])
 startDatabase()
 await ready(()=>run(['exec',db,'pg_isready','-h','127.0.0.1','-U','supabase_admin','-d','postgres']).includes('accepting'))
 sql("alter system set cron.launch_active_jobs=off;")
 sql("select pg_reload_conf();")
 sql(baseline)
 sql('create extension if not exists pg_cron; create extension if not exists pgtap with schema extensions;')
 migrate('baseline')
 const uid=randomUUID()
 sql(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values('${uid}','authenticated','authenticated','${uid}@example.invalid','x',now(),'{}','{}',now(),now());
 select public._wallet_credit_cash('${uid}',25);
 select public._ledger_record('${uid}','upgrade-proof','cash','credit',25,'test','test','preservation');
 select public.reserve_infinitepay_cash_purchase('${uid}','pack_25');`)
 const snapshot=`select jsonb_build_object('wallet',(select to_jsonb(w) from public.wallets w where user_id='${uid}'),'ledger',(select jsonb_agg(to_jsonb(t)-'content_fingerprint' order by id) from public.economy_transactions t where user_id='${uid}'),'purchase',(select jsonb_agg(to_jsonb(p)-'payment_check_after'-'checkout_valid_until'-'reversed_centavos'-'reconciliation_attempts'-'reconciliation_after'-'reconciliation_claim_token') from public.cash_purchases p where user_id='${uid}'));`
 const before=JSON.parse(sql(snapshot))
 migrate('candidate')
 const after=JSON.parse(sql(snapshot))
 const incremental=JSON.parse(sql(contract))
 const hash=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex')
 const result={localOnly:true,realServiceSchemas:true,cleanInstall:true,populatedUpgrade:true,financialSchemaEqual:hash(clean)===hash(incremental),existingDataPreserved:hash(before)===hash(after),cleanSchemaSha256:hash(clean),incrementalSchemaSha256:hash(incremental),beforeDataSha256:hash(before),afterDataSha256:hash(after)}
 writeFileSync('docs/audits/finance-integration/install-results.json',JSON.stringify(result,null,2)+'\n')
 if(!result.financialSchemaEqual||!result.existingDataPreserved)throw new Error('Installation/schema/data preservation mismatch')
 console.log(JSON.stringify(result))
} finally {for(const n of sidecars){try{run(['rm','-f',n])}catch{/* absent */}}}
