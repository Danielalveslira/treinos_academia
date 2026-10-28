// Only the fixed disposable integrated PostgreSQL. No DB URL or linked CLI accepted.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const mode=process.argv[2]
if(!['baseline','candidate','all'].includes(mode))throw new Error('baseline | candidate | all')
const container=process.argv[3]||'evolutus_integrated_db'
if(!['evolutus_integrated_db','evolutus_integrated_clean_db','evolutus_release_ci_db'].includes(container) && !/^evolutus_consolidation_clean_[0-9]{14}$/.test(container))throw new Error('Local test container required')
const root=resolve(import.meta.dirname,'../../..')
const logDir=root+'/.finance-local/logs'
mkdirSync(logDir,{recursive:true})
execFileSync('docker',['exec',container,'psql','-U','supabase_admin','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',"create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);"],{stdio:'pipe'})
const applied = new Set(execFileSync('docker',['exec',container,'psql','-U','supabase_admin','-d','postgres','-X','-tAc','select version from supabase_migrations.schema_migrations'],{encoding:'utf8'}).trim().split('\n'))
const results=[]
for(const name of readdirSync(root+'/supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) {
 if(mode==='baseline'&&name.slice(0,14)>'20261111000001')continue
 if(mode==='candidate'&&name.slice(0,14)<='20261111000001')continue
 if(applied.has(name.slice(0,14)))continue
 const source=readFileSync(root+'/supabase/migrations/'+name,'utf8')
 try {
  const result=execFileSync('docker',['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-1','-v','ON_ERROR_STOP=1'],{input:source+`\ninsert into supabase_migrations.schema_migrations(version,name) values('${name.slice(0,14)}','${name}') on conflict(version) do nothing;\n`,encoding:'utf8',stdio:['pipe','pipe','pipe']})
  results.push({file:name,passed:true})
  writeFileSync(logDir+'/'+container+'-'+name+'.log',result)
 } catch(e) {writeFileSync(logDir+'/migration-failure.log',String(e.stderr));throw new Error('Migration failed: '+name)}
}
writeFileSync(logDir+'/'+container+'-'+mode+'.json',JSON.stringify(results,null,2))
console.log(JSON.stringify({mode,container,migrations:results.length,passed:true}))
