// Disposable local/CI PostgreSQL only. No remote URL or production credentials accepted.
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const container = 'supabase_db_treinos_academia'
const uid = '96a00000-0000-0000-0000-000000000001'
const eid = '96e00000-0000-0000-0000-000000000001'
const sid = '96b00000-0000-0000-0000-000000000001'
const cid = '96c00000-0000-0000-0000-000000000001'
const helper = readFileSync('supabase/tests/_helpers/auth_session.sql', 'utf8')
const args = [
  'exec',
  '-i',
  container,
  'psql',
  '-U',
  'supabase_admin',
  '-d',
  'postgres',
  '-X',
  '-At',
  '-v',
  'ON_ERROR_STOP=1',
]
const sql = (input) => execFileSync('docker', args, { input, encoding: 'utf8', maxBuffer: 4e6 })
const actor = `${helper}\nselect pg_temp.set_test_user('${uid}',false); set role authenticated;\n`
function processSql(input, name) {
  const a = [...args]
  a.splice(1, 0, '-e', `PGAPPNAME=${name}`)
  const child = spawn('docker', a, { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '',
    err = '',
    readyResolve
  const ready = new Promise((resolve) => {
    readyResolve = resolve
  })
  child.stdout.on('data', (data) => {
    out += data
    if (out.includes('LOCKED')) readyResolve()
  })
  child.stderr.on('data', (data) => {
    err += data
  })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
  })
  child.stdin.write(input)
  return { child, ready, done }
}
const insert = `insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
 values('${uid}','${eid}',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]','${sid}');`
try {
  sql(`select set_config('request.jwt.claim.sub','',false);
    insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('${uid}','authenticated','authenticated','home-concurrency@example.invalid',now(),'{}','{}',now(),now());
    update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest from public.legal_policy p where p.id and u.id='${uid}';
    insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
    values('${cid}','evolutus_dataset','home-concurrency','Oficial','peito',array['peito'],'forca',array['Empurre'],'published');
    insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id,type)
    values('${eid}','${uid}','Oficial','Peito','catalog','evolutus_dataset','home-concurrency','${cid}','strength');
    insert into public.workout_sheets(id,user_id,name,create_request_id) values('${sid}','${uid}','Concorrência','${sid}');
    insert into public.workout_sheet_exercises(sheet_id,user_id,exercise_id,sort_order) values('${sid}','${uid}','${eid}',0);`)
  const scenarios = [
    {
      name: 'archive',
      change: `update public.workout_sheets set archived_at=now() where id='${sid}';`,
      error: 'SHEET_NOT_READY',
    },
    {
      name: 'remove-item',
      change: `select 1 from public.workout_sheets where id='${sid}' for update; delete from public.workout_sheet_exercises where sheet_id='${sid}';`,
      error: 'SHEET_EXERCISE_MISMATCH',
    },
    {
      name: 'withdraw-catalog',
      change: `update public.exercise_catalog set status='draft' where id='${cid}';`,
      error: 'SHEET_EXERCISE_UNAVAILABLE',
    },
  ]
  for (const scenario of scenarios) {
    sql(`update public.workout_sheets set archived_at=null where id='${sid}';
      update public.exercise_catalog set status='published' where id='${cid}';
      insert into public.workout_sheet_exercises(sheet_id,user_id,exercise_id,sort_order) values('${sid}','${uid}','${eid}',0) on conflict do nothing;`)
    const holder = processSql(`begin;${scenario.change}\n\\echo LOCKED\n`, 'home-v2-holder')
    const deadline = setTimeout(() => holder.child.kill(), 15000)
    let waiter
    try {
      await holder.ready
      waiter = processSql(actor + insert + '\n', 'home-v2-waiter')
      waiter.child.stdin.end()
      let blocked = false
      for (let n = 0; n < 30 && !blocked; n++) {
        blocked =
          sql(
            "select exists(select 1 from pg_stat_activity where application_name='home-v2-waiter' and cardinality(pg_blocking_pids(pid))>0);"
          ).trim() === 't'
        if (!blocked) await new Promise((r) => setTimeout(r, 25))
      }
      assert.ok(blocked, `${scenario.name}: actual competing transaction must wait for the lock`)
      holder.child.stdin.end('commit;\n')
      assert.equal((await holder.done).code, 0)
      const result = await waiter.done
      assert.notEqual(result.code, 0)
      assert.ok(result.err.includes(scenario.error), result.err)
      assert.equal(sql(`select count(*) from public.workouts where user_id='${uid}';`).trim(), '0')
      console.log(
        `PASS concurrency ${scenario.name}: waits, revalidates committed state, no partial insert`
      )
    } finally {
      clearTimeout(deadline)
      if (!holder.child.stdin.destroyed) holder.child.stdin.end('rollback;\n')
      await holder.done
    }
  }
  sql(`update public.exercise_catalog set status='published' where id='${cid}';`)
  // Inverse order: an accepted INSERT protects its association until commit.
  const holder = processSql(
    'begin;' + actor + insert + '\n\\echo LOCKED\n',
    'home-v2-insert-holder'
  )
  try {
    await holder.ready
    assert.throws(
      () =>
        sql(
          `begin;set local lock_timeout='150ms';update public.workout_sheets set archived_at=now() where id='${sid}';commit;`
        ),
      /lock timeout/
    )
    holder.child.stdin.end('commit;\n')
    assert.equal((await holder.done).code, 0)
    console.log('PASS concurrency insert: archive waits for accepted attribution')
  } finally {
    if (!holder.child.stdin.destroyed) holder.child.stdin.end('rollback;\n')
    await holder.done
  }
  sql(
    actor +
      `insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
    select '${uid}','${eid}',(now() at time zone 'America/Sao_Paulo')::date-(n%730),1,'[{"weight":10,"reps":10}]','${sid}' from generate_series(1,2000)n;
    reset role; vacuum analyze public.workouts;`
  )
  console.log(
    sql(
      actor +
        `explain(analyze,buffers) select sheet_id,max(date),max(created_at),
    count(distinct date) filter(where date>=date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)::date)
    from public.workouts where user_id='${uid}' and sheet_id is not null and date<=(now() at time zone 'America/Sao_Paulo')::date group by sheet_id;`
    )
  )
  console.log(sql(actor + 'explain(analyze,buffers) select public.get_my_sheet_insights();'))
} finally {
  sql(
    `select set_config('request.jwt.claim.sub','',false);delete from auth.users where id='${uid}';delete from public.exercise_catalog where id='${cid}';`
  )
}
