// Disposable local/CI PostgreSQL only. No remote URL or production credentials accepted.
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const container = process.env.PG_TEST_CONTAINER || 'supabase_db_treinos_academia'
if (
  ![
    'supabase_db_treinos_academia',
    'evolutus_integrated_db',
    'evolutus_integrated_clean_db',
  ].includes(container)
)
  throw new Error('Disposable local container required')
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
// Privileged fixture cleanup in an allowlisted disposable DB only; production ledger guards stay intact.
function cleanup() {
  sql(`select set_config('request.jwt.claim.sub','',false);
 set session_replication_role=replica;
 update public.economy_transactions set user_id=null where user_id='${uid}';
 set session_replication_role=origin;
 delete from auth.users where id='${uid}';delete from public.exercise_catalog where id='${cid}';`)
}
cleanup()
let restoreDefinition
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

  sql(actor + insert.repeat(3))
  const finish = `select public.complete_workout_sheet('${sid}');`
  const holder = processSql(actor + 'begin;' + finish + '\n\\echo LOCKED\n', 'v4-completion-holder')
  const deadline = setTimeout(() => holder.child.kill(), 15000)
  try {
    await holder.ready
    const waiter = processSql(actor + finish + '\n', 'v4-completion-waiter')
    waiter.child.stdin.end()
    let blocked = false
    for (let n = 0; n < 40 && !blocked; n++) {
      blocked =
        sql(
          "select exists(select 1 from pg_stat_activity where application_name='v4-completion-waiter' and cardinality(pg_blocking_pids(pid))>0);"
        ).trim() === 't'
      if (!blocked) await new Promise((r) => setTimeout(r, 25))
    }
    assert.ok(blocked, 'second tab waits for the completion transaction')
    holder.child.stdin.end('commit;\n')
    const first = await holder.done,
      second = await waiter.done
    assert.equal(first.code, 0)
    assert.equal(second.code, 0)
    assert.match(first.out, /"status": "completed"/)
    assert.match(second.out, /"status": "already_completed"/)
    assert.equal(
      sql(`select count(*) from public.workout_sheet_completions where user_id='${uid}';`).trim(),
      '1'
    )
  } finally {
    clearTimeout(deadline)
    if (!holder.child.stdin.destroyed) holder.child.stdin.end('rollback;\n')
    await holder.done
  }
  // Measure the exact CTE returned by pg_get_functiondef, both versions, same database/data.
  const current = (restoreDefinition = sql(
    "select pg_get_functiondef('public.get_my_sheet_insights()'::regprocedure);"
  ))
  const old = readFileSync(
    'supabase/migrations/20261123000001_workout_sheet_attribution.sql',
    'utf8'
  )
  const baseline = old
    .slice(old.indexOf('create function public.get_my_sheet_insights()'))
    .replace('create function', 'create or replace function')
  sql(`insert into public.workout_sheets(id,user_id,name,sort_order,create_request_id,archived_at)
    select md5('home-v4-sheet-'||n)::uuid,'${uid}','V4 '||n,n,md5('home-v4-sheet-'||n)::uuid,
      case when n>40 then now() end from generate_series(2,45)n;
    insert into public.workout_sheet_exercises(sheet_id,user_id,exercise_id,sort_order)
    select md5('home-v4-sheet-'||n)::uuid,'${uid}','${eid}',0 from generate_series(2,45)n;`)
  const results = []
  for (const rows of [2000, 10000]) {
    sql(`select set_config('request.jwt.claim.sub','',false);delete from public.workouts where user_id='${uid}';
      set session_replication_role=replica;
      insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
      select '${uid}','${eid}',(now() at time zone 'America/Sao_Paulo')::date-(n%730),1,'[{"weight":10,"reps":10}]',case when n%45=0 then '${sid}'::uuid else md5('home-v4-sheet-'||(n%45+1))::uuid end from generate_series(1,${rows}) n;
      set session_replication_role=origin;analyze public.workouts;`)
    for (const [version, definition] of [
      ['before', baseline],
      ['after', current],
    ]) {
      sql(definition)
      const exact = definition.match(
        /with activity(?:_days)? as[\s\S]*?into result from selected;/i
      )?.[0]
      assert.ok(exact)
      const query = exact
        .replace('into result', '')
        .replace(/\bu\b/g, `'${uid}'::uuid`)
        .replace(/(?<!')\btoday\b(?!')/g, "(now() at time zone 'America/Sao_Paulo')::date")
      // Warm once; report three samples, including buffers and the full actual plan.
      sql('explain(analyze,buffers,format json) ' + query)
      const samples = []
      for (let n = 0; n < 3; n++)
        samples.push(JSON.parse(sql('explain(analyze,buffers,format json) ' + query))[0])
      const payloadBytes = Number(
        sql(actor + 'select octet_length(public.get_my_sheet_insights()::text);')
          .trim()
          .split('\n')
          .at(-1)
      )
      results.push({ rows, version, payloadBytes, samples })
    }
    sql(current)
  }
  mkdirSync('.finance-local/home-v4', { recursive: true })
  writeFileSync(
    '.finance-local/home-v4/sql-evidence.json',
    JSON.stringify({ concurrentCompletion: true, results }, null, 2)
  )
  console.log(
    JSON.stringify(
      {
        concurrentCompletion: true,
        results: results.map(({ rows, version, payloadBytes, samples }) => ({
          rows,
          version,
          payloadBytes,
          executionMs: samples.map((s) => s['Execution Time']),
          sharedHits: samples.map((s) => s.Plan['Shared Hit Blocks']),
          sharedReads: samples.map((s) => s.Plan['Shared Read Blocks']),
        })),
      },
      null,
      2
    )
  )
} finally {
  if (restoreDefinition) sql(restoreDefinition)
  cleanup()
}
