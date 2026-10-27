// Exercises the real pg_cron scheduler ONLY in this task's disposable container.
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
const container='evolutus_home_public_v2_test_db'
const sql=source=>execFileSync('docker',['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:source,encoding:'utf8'}).trim()
const id='98cc0000-0000-0000-0000-000000000001'
const started=new Date().toISOString()
try{
 sql("update cron.job set active=false; select cron.schedule('refresh-public-catalog-snapshot','1 second',$$select private.refresh_public_catalog_snapshot()$$); update cron.job set active=true where jobname='refresh-public-catalog-snapshot';")
 sql(`create sequence private.home_snapshot_failure_once;
 create function private.home_snapshot_fail_once() returns trigger language plpgsql as $$begin if nextval('private.home_snapshot_failure_once')=1 then raise exception 'TEST_TRANSIENT_FAILURE';end if;return new;end$$;
 create trigger home_snapshot_failure_once before update on public.public_catalog_snapshot for each row execute function private.home_snapshot_fail_once();
 insert into public.exercise_catalog(id,provider,provider_exercise_id,name,status,primary_muscle,muscles,category,instructions) values('${id}','evolutus_dataset','home-cron-retry','Cron retry','published','peito',array['peito'],'forca',array['Empurre']);`)
 sql('alter system set cron.launch_active_jobs=on;');sql('select pg_reload_conf();')
 let converged=false
 for(let i=0;i<30;i++){
  if(sql('select generation=published_generation from private.public_catalog_refresh')==='t'){converged=true;break}
  await new Promise(resolve=>setTimeout(resolve,500))
 }
 assert.ok(converged,'real scheduler must automatically retry and converge')
 const statuses=JSON.parse(sql(`select coalesce(json_agg(json_build_object('status',status,'message',return_message) order by runid),'[]') from cron.job_run_details where jobid=(select jobid from cron.job where jobname='refresh-public-catalog-snapshot') and start_time>='${started}'::timestamptz`))
 assert.ok(statuses.some(x=>x.status==='failed'&&x.message.includes('TEST_TRANSIENT_FAILURE')))
 assert.ok(statuses.some(x=>x.status==='succeeded'))
 const result={passed:true,realScheduler:true,localTestCadenceSeconds:1,productionCadenceSeconds:60,automaticRetry:true,converged,statuses}
 writeFileSync('docs/public-home-v2-evidence/cron-retry.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
}finally{
 sql('alter system set cron.launch_active_jobs=off;');sql('select pg_reload_conf();')
 sql(`drop trigger if exists home_snapshot_failure_once on public.public_catalog_snapshot;drop function if exists private.home_snapshot_fail_once();drop sequence if exists private.home_snapshot_failure_once;delete from public.exercise_catalog where id='${id}';select private.refresh_public_catalog_snapshot();select cron.schedule('refresh-public-catalog-snapshot','* * * * *',$$select private.refresh_public_catalog_snapshot()$$);`)
}
