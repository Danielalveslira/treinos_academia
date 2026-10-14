// Fixed isolated stack; real Auth/PostgREST sessions, no production URLs or .env.
import assert from 'node:assert/strict'
import {execFileSync,spawn} from 'node:child_process'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {createClient} from '@supabase/supabase-js'
import {jwt} from './homolog/keys.mjs'
import {startAudGateway} from './homolog/aud-local-gateway.mjs'
const sql=input=>execFileSync('docker',['exec','-i','evolutus_homolog_db','psql','-U','supabase_admin','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
const good=({data,error})=>{assert.equal(error,null);return data}
let checks=0
const check=(value,label)=>{assert.ok(value,label);checks++;console.log(`PASS ${label}`)}
const gateway=await startAudGateway()
const opts={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient('http://127.0.0.1:55439',jwt({role:'service_role'}),opts)
const [owner,member,other,root,stranger,community]=Array.from({length:6},()=>randomUUID())
const ids=[owner,member,other,root,stranger]
const clients=[]
const counts=id=>JSON.parse(sql(`select row_to_json(t) from private.status_publication_limits t where user_id='${id}';`)||'null')
const post=(client,id,type='text',extra={})=>client.from('statuses').insert({id:randomUUID(),community_id:community,author_id:id,type,...(type==='text'?{text:'x'}:{}),...extra})
try {
  assert.equal(sql("select current_setting('cron.launch_active_jobs')"),'off')
  for(const id of ids){
    const email=`aud07-${id}@example.invalid`
    good(await admin.auth.admin.createUser({id,email,password:'Synthetic-Aud07-923!',email_confirm:true}))
    const client=createClient('http://127.0.0.1:55439',jwt({role:'anon'}),opts)
    good(await client.auth.signInWithPassword({email,password:'Synthetic-Aud07-923!'}))
    clients.push(client)
  }
  const [,voter,second,superadmin,outsider]=clients
  sql(`update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now() from public.legal_policy p where p.id and u.id in(${ids.map(x=>`'${x}'`).join(',')});
    update public.users set role='superadmin' where id='${root}';
    insert into public.communities(id,name,created_by,owner_id) values('${community}','AUD07 local','${owner}','${owner}');
    insert into public.community_members(community_id,user_id) values('${community}','${member}'),('${community}','${other}'),('${community}','${root}');`)
  // Original contract, reconstructed only inside a rolled-back local transaction.
  const baseline=sql(`begin; drop trigger statuses_check_publication_rate on public.statuses;
    select set_config('request.jwt.claim.sub','${member}',true); set local role authenticated;
    insert into public.statuses(community_id,author_id,type,text)
    select '${community}','${member}','text','x' from generate_series(1,20);
    select count(*) from public.statuses where author_id='${member}'; rollback;`)
  check(baseline.includes('20'),'BEFORE 20 rapid publications accepted under original RLS')
  await good(await post(voter,member))
  good(await post(voter,member,'poll',{poll_question:'Q?',poll_options:[{id:'a',label:'A'},{id:'b',label:'B'}]}))
  good(await post(voter,member,'workout',{workout_title:'W',workout_location:'L',workout_date:new Date(Date.now()+86400000).toISOString()}))
  good(await post(voter,member,'achievement',{achievement_day:'2026-10-14',achievement_text:'x'}))
  const photoId=randomUUID()
  good(await voter.from('statuses').insert({id:photoId,community_id:community,author_id:member,type:'photo',photo_path:`statusPhotos/${community}/${photoId}.webp`}))
  check(counts(member).minute_count===5,'all five publication types counted')
  const rejected=await post(voter,member)
  check(rejected.error?.code==='PT429'&&rejected.status===429,'legacy direct API rejects sixth publication with HTTP 429')
  check(counts(member).minute_count===5,'refused insert does not consume quota')
  const denied=await post(outsider,stranger)
  check(!!denied.error&&counts(stranger)===null,'unauthorized attempt creates no quota')
  const anonymous=createClient('http://127.0.0.1:55439',jwt({role:'anon'}),opts)
  check(!!(await post(anonymous,stranger)).error,'anon denied')
  // Preserve history even when the actual posts are deleted/expired.
  sql(`delete from public.statuses where author_id='${member}';`)
  check((await post(voter,member)).error?.code==='PT429','deletion of posts does not reset quota')
  sql(`update private.status_publication_limits set minute_start=minute_start-interval '2 minutes' where user_id='${member}';`)
  good(await post(voter,member))
  check(counts(member).minute_count===1&&counts(member).hour_count===6,'minute recovery keeps hour history')
  sql(`update private.status_publication_limits set hour_count=30 where user_id='${member}';`)
  check((await post(voter,member)).error?.code==='PT429','hour quota enforced')
  sql(`update private.status_publication_limits set hour_start=hour_start-interval '2 hours',day_count=100 where user_id='${member}';`)
  check((await post(voter,member)).error?.code==='PT429','day quota enforced after hour recovery')
  sql(`update private.status_publication_limits set minute_start=minute_start-interval '2 minutes',hour_start=hour_start-interval '2 hours',day_start=day_start-interval '2 days' where user_id='${member}';`)
  good(await post(voter,member))
  check(counts(member).day_count===1,'day window recovers using server time')
  const retryId=randomUUID()
  const payload={id:retryId,community_id:community,author_id:member,type:'text',text:'x'}
  good(await voter.from('statuses').insert(payload))
  const before=counts(member).day_count
  good(await voter.from('statuses').upsert(payload,{onConflict:'id',ignoreDuplicates:true}))
  check(counts(member).day_count===before,'ON CONFLICT DO NOTHING retry is not counted twice')
  check(!!(await voter.from('statuses').upsert(payload)).error&&counts(member).day_count===before,'UPDATE UPSERT remains denied without consuming quota')
  check(!!(await voter.from('statuses').insert(payload)).error&&counts(member).day_count===before,'duplicate INSERT rolls back quota')
  const rollback=counts(member)
  sql(`begin; select set_config('request.jwt.claim.sub','${member}',true); set local role authenticated;
    insert into public.statuses(community_id,author_id,type,text) values('${community}','${member}','text','x'); rollback;`)
  check(JSON.stringify(counts(member))===JSON.stringify(rollback),'transaction rollback restores counters')
  const latency=[]
  const burst=await Promise.all(Array.from({length:24},async()=>{const t=performance.now();const r=await post(second,other);latency.push(performance.now()-t);return r}))
  check(burst.filter(r=>!r.error).length===5&&burst.filter(r=>r.error?.code==='PT429').length===19,'24 concurrent API requests: exactly five creations')
  check(counts(other).minute_count===5,'concurrent total equals committed creations')
  good(await post(superadmin,root))
  check(counts(root).minute_count===1,'authenticated superadmin is limited and isolated from other users')
  const bulk=await superadmin.from('statuses').insert(Array.from({length:5},()=>({community_id:community,author_id:root,type:'text',text:'x'})))
  check(bulk.error?.code==='PT429'&&counts(root).minute_count===1,'over-limit multirow INSERT is fully rolled back')
  // Real second DB session holds one user's quota row. Another user can publish
  // while that lock remains held: no global lock serializes independent accounts.
  const holder=spawn('docker',['exec','-i','evolutus_homolog_db','psql','-U','supabase_admin','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
  const ready=new Promise((resolve,reject)=>{let output='';holder.stdout.on('data',x=>{output+=x;if(output.includes('HELD'))resolve()});holder.once('error',reject)})
  holder.stdin.write(`begin; select user_id from private.status_publication_limits where user_id='${member}' for update; select 'HELD';\n`)
  await ready
  try{
   const started=performance.now()
   good(await post(superadmin,root))
   check(performance.now()-started<1500,'another account publishes while one quota row is locked')
  }finally{holder.stdin.end('rollback;\n');await once(holder,'close')}
  sql(`insert into public.statuses(community_id,author_id,type,text) select '${community}','${owner}','text','x' from generate_series(1,8);`)
  check(counts(owner)===null,'trusted backend maintenance exception requires non-client SQL role')
  latency.sort((a,b)=>a-b)
  console.log(JSON.stringify({checks,burstRequests:24,burstCreated:5,p95Ms:+latency[Math.ceil(latency.length*.95)-1].toFixed(2)}))
} finally {
  sql(`delete from public.communities where id='${community}'; delete from public.storage_cleanup_tasks where reference like '%${community}%';`)
  for(const id of ids)good(await admin.auth.admin.deleteUser(id))
  await new Promise(resolve=>gateway.close(resolve))
}
