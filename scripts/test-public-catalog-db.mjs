// Local disposable container ONLY. Does not accept remote credentials or URLs.
import {execFileSync} from 'node:child_process'
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs'
const container='evolutus_home_public_v2_test_db'
const folder='docs/public-home-v2-evidence'
mkdirSync(folder,{recursive:true})
const sql=(source)=>execFileSync('docker',['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:source,encoding:'utf8',maxBuffer:30e6})
if(process.argv[2]==='prepare'){
 sql('alter system set cron.launch_active_jobs=off;')
 sql('select pg_reload_conf();')
 sql(readFileSync('scripts/offline-local-supabase-baseline.sql','utf8'))
 sql('create extension if not exists pg_cron; create extension if not exists pgtap with schema extensions; create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key);')
 const applied=sql('select version from supabase_migrations.schema_migrations;')
 for(const name of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
  if(applied.includes(name.slice(0,14)))continue
  try {sql(`begin;\n${readFileSync('supabase/migrations/'+name,'utf8')}\ninsert into supabase_migrations.schema_migrations values('${name.slice(0,14)}');commit;`)}
  catch(e){writeFileSync('/tmp/public-home-v2-migration-error.log',String(e.stderr));throw Error('Migration failed: '+name)}
 }
 console.log('LOCAL_MIGRATIONS_OK')
}else{
 const output=execFileSync('docker',['exec','-w','/workspace/supabase/tests',container,'psql','-U','supabase_admin','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1','-f','public_catalog_snapshot_test.sql'],{encoding:'utf8',maxBuffer:20e6})
 writeFileSync(folder+'/pgtap.log',output)
 if(output.includes('not ok')||!output.includes('1..'))throw Error('PGTAP_FAILED')
 console.log(output)
}
