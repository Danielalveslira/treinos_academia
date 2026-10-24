// Offline metadata comparison only: never executes definitions or contacts a database.
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const [localFile,remoteFile,localCatalogFile,remoteCatalogFile,outputFile]=process.argv.slice(2)
if(!outputFile)throw Error('Expected local/remote metadata, local/remote catalogs and output file')
const read=(file,key)=>{let r=JSON.parse(readFileSync(file,'utf8'));if(r.rows)r=r.rows[0][key];return typeof r==='string'?JSON.parse(r):r}
const local=read(localFile,'financial_preflight'),remote=read(remoteFile,'financial_preflight')
const lc=read(localCatalogFile,'finance_catalog'),rc=read(remoteCatalogFile,'finance_catalog')
const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x
const canonical=x=>JSON.stringify(ordered(x))
const equal=(a,b)=>canonical(a)===canonical(b)
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex')
const owners=new Set(['postgres','supabase_admin','pg_database_owner'])
function grants(row){return [...new Map((row.grants||[]).map(g=>({...g,role:owners.has(g.role)?'__owner__':g.role})).map(g=>[canonical(g),g])).values()].sort((a,b)=>canonical(a).localeCompare(canonical(b)))}
function security(row){const {owner,...rest}=row;return {...rest,owner:owners.has(owner)?'__owner__':owner,grants:grants(row)}}
function map(rows,key){return new Map((rows||[]).map(r=>[typeof key==='function'?key(r):r[key],r]))}
const changes=[]
function compare(kind,left,right,key,clean=x=>x){
 const a=map(left,key),b=map(right,key)
 for(const id of [...new Set([...a.keys(),...b.keys()])].sort()){
  if(!a.has(id)||!b.has(id)){changes.push({kind,object:id,change:a.has(id)?'missing_remote':'extra_remote'});continue}
  const x=clean(a.get(id),lc),y=clean(b.get(id),rc)
  if(!equal(x,y)){const fields=[...new Set([...Object.keys(x),...Object.keys(y)])].filter(k=>!equal(x[k],y[k]));changes.push({kind,object:id,fields,local_sha256:digest(x),remote_sha256:digest(y)})}
 }
}
compare('function_definition',local.functions,remote.functions,'signature',r=>({signature:r.signature,definition:r.definition}))
compare('function_security',lc.function_security,rc.function_security,'signature',security)
compare('relation',local.relations,remote.relations,'table',r=>{const {acl,...rest}=r;return rest})
compare('relation_security',lc.relation_security,rc.relation_security,'name',security)
compare('trigger',lc.triggers,rc.triggers,r=>r.table+':'+r.name)
compare('schema',lc.schemas,rc.schemas,'name',security)
compare('view',lc.views,rc.views,'name',r=>{const {acl,...rest}=r;return rest})
compare('enum',lc.enums,rc.enums,'type')
compare('column_grants',lc.column_grants,rc.column_grants,r=>r.table+':'+r.column,(r,c)=>{
 const owner=c.relation_security?.find(x=>x.name===r.table)?.owner
 let acl=r.acl
 if(owners.has(owner))acl=acl.replaceAll('/'+owner,'/__owner__').replaceAll(owner+'=','__owner__=')
 return {...r,acl:acl.slice(1,-1).split(',').sort()}
})
compare('job',lc.jobs,rc.jobs,'name')
const localVersions=new Set(local.migration_versions),remoteVersions=new Set(remote.migration_versions)
const result={baseline_local_version:local.latest_migration,remote_version:remote.latest_migration,versions_equal:equal([...localVersions].sort(),[...remoteVersions].sort()),
 local_only_versions:[...localVersions].filter(v=>!remoteVersions.has(v)),remote_only_versions:[...remoteVersions].filter(v=>!localVersions.has(v)),
 compared:{functions:local.functions.length,relations:local.relations.length,triggers:lc.triggers?.length||0,views:lc.views?.length||0,enums:lc.enums?.length||0,jobs:lc.jobs?.length||0},changes,
 normalization:'Only the privileged DBA/owner roles postgres/supabase_admin/pg_database_owner are normalized and their duplicate ACL entries collapsed; all client grants, function bodies, RLS, constraints, indexes and trigger states remain compared.',
 privileged_ownership:{local:lc.function_security.reduce((a,r)=>(a[r.owner]=(a[r.owner]||0)+1,a),{}),remote:rc.function_security.reduce((a,r)=>(a[r.owner]=(a[r.owner]||0)+1,a),{})},extensions:{local:lc.extensions,remote:rc.extensions},disabled_fk_triggers:rc.disabled_fk_triggers}
writeFileSync(outputFile,JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({versions_equal:result.versions_equal,compared:result.compared,changes:result.changes.map(({kind,object,fields,change})=>({kind,object,fields,change}))}))
