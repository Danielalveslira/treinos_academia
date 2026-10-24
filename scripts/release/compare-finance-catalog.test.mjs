import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
const script=new URL('./compare-finance-catalog.mjs',import.meta.url).pathname
function fixture(owner){return {function_security:[{signature:'public.credit()',owner,definer:true,config:["search_path=\"\""],language:'plpgsql',grants:[{role:owner,privilege:'EXECUTE',grantable:false},...(owner==='supabase_admin'?[{role:'postgres',privilege:'EXECUTE',grantable:false}]:[]),{role:'service_role',privilege:'EXECUTE',grantable:false}]}],relation_security:[],triggers:[],schemas:[],views:[],enums:[],column_grants:[],jobs:[],extensions:[],disabled_fk_triggers:0}}
function run(change=()=>{}){
 const dir=mkdtempSync(join(tmpdir(),'finance-catalog-test-'))
 try{
  const metadata={latest_migration:'1',migration_versions:['1'],functions:[{signature:'public.credit()',definition:'safe definition'}],relations:[]}
  const remote=structuredClone(metadata),localCatalog=fixture('supabase_admin'),remoteCatalog=fixture('postgres')
  change(remote,remoteCatalog)
  const paths=['local.json','remote.json','local-catalog.json','remote-catalog.json','result.json'].map(n=>join(dir,n))
  for(const [i,data] of [metadata,remote,localCatalog,remoteCatalog].entries())writeFileSync(paths[i],JSON.stringify(data))
  const output=execFileSync(process.execPath,[script,...paths],{encoding:'utf8'})
  return {result:JSON.parse(readFileSync(paths[4],'utf8')),output}
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test('normalizes only privileged DBA duplicates, preserving equivalent application ACLs',()=>{assert.deepEqual(run().result.changes,[])})
test('detects a newly granted anonymous financial helper without printing definitions',()=>{
 const {result}=run((_m,c)=>c.function_security[0].grants.push({role:'anon',privilege:'EXECUTE',grantable:false}))
 assert.equal(result.changes[0].kind,'function_security');assert.deepEqual(result.changes[0].fields,['grants'])
})
test('reports modified code and unexpected ownership; never logs function body',()=>{
 const {result,output}=run((m,c)=>{m.functions[0].definition='SECRET_SENTINEL';c.function_security[0].owner='authenticated'})
 assert.ok(result.changes.some(x=>x.kind==='function_definition'))
 assert.ok(result.changes.some(x=>x.kind==='function_security'&&x.fields.includes('owner')))
 assert.ok(!output.includes('SECRET_SENTINEL'))
})
test('detects extra trigger and journal divergence',()=>{
 const {result}=run((m,c)=>{m.migration_versions.push('2');c.triggers.push({table:'public.wallets',name:'unexpected',enabled:'D'})})
 assert.equal(result.versions_equal,false);assert.deepEqual(result.remote_only_versions,['2'])
 assert.equal(result.changes[0].kind,'trigger');assert.equal(result.changes[0].change,'extra_remote')
})
