import assert from 'node:assert/strict'
import {execFileSync,spawn} from 'node:child_process'
import {writeFileSync} from 'node:fs'
const container='evolutus_home_public_v2_test_db'
const args=['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1']
const sql=source=>execFileSync('docker',args,{input:source,encoding:'utf8'}).trim()
const run=source=>new Promise((resolve,reject)=>{
 const child=spawn('docker',args);let out='',error=''
 child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c)
 child.on('error',reject);child.on('close',code=>code?reject(Error(error)):resolve(out));child.stdin.end(source)
})
const ids=['98cb0000-0000-0000-0000-000000000001','98cb0000-0000-0000-0000-000000000002']
const snapshot=()=>JSON.parse(sql("select json_build_object('total',total_active,'revision',revision) from public.public_catalog_snapshot"))
const baseline=snapshot()
try {
 for(const [i,id] of ids.entries())sql(`insert into public.exercise_catalog(id,provider,provider_exercise_id,name,status,primary_muscle,muscles,category,instructions) values('${id}','evolutus_dataset','home-concurrent-${i}','Concurrent ${i}','draft','peito',array['peito'],'forca',array['Empurre']);`)
 await Promise.all([
  run(`begin;update public.exercise_catalog set status='published' where id='${ids[0]}';select pg_sleep(0.2);commit;`),
  run(`begin;update public.exercise_catalog set status='published' where id='${ids[1]}';commit;`),
  run('select private.refresh_public_catalog_snapshot();'),
  run('select private.refresh_public_catalog_snapshot();'),
 ])
 sql('select private.refresh_public_catalog_snapshot();')
 const published=snapshot();assert.equal(published.total,baseline.total+2)
 assert.ok(BigInt(published.revision)>BigInt(baseline.revision))
 await Promise.all([
  run(`update public.exercise_catalog set status='withdrawn' where id='${ids[0]}';`),
  run(`update public.exercise_catalog set status='withdrawn' where id='${ids[1]}';`),
  run('select private.refresh_public_catalog_snapshot();'),
 ])
 await Promise.all(Array.from({length:5},()=>run('select private.refresh_public_catalog_snapshot();')))
 const final=snapshot();assert.equal(final.total,baseline.total)
 assert.ok(BigInt(final.revision)>BigInt(published.revision))
 assert.equal(sql('select generation=published_generation from private.public_catalog_refresh'),'t')
 const result={passed:true,concurrentPublications:2,concurrentWithdrawals:2,duplicateWorkers:5,baseline,published,final,converged:true}
 writeFileSync('docs/public-home-v2-evidence/concurrency.json',JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result))
}finally{
 sql(`delete from public.exercise_catalog where id in ('${ids.join("','")}');select private.refresh_public_catalog_snapshot();`)
}
