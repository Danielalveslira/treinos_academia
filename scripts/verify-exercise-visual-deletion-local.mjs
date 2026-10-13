import { ensureVisualTestFixtures } from './exercise-visual-test-fixtures.mjs'
// Local only. Real Auth/PostgREST/Storage, real SQL functions and bundled Edge handlers.
// Requires local stack + migration and cron.launch_active_jobs=off; generates synthetic fixtures on demand.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { build } from 'esbuild'
import { jwt } from './homolog/keys.mjs'
import { startAudGateway } from './homolog/aud-local-gateway.mjs'
import { processVisualDeletions } from '../supabase/functions/delete-exercise-visual/worker.js'
const url = 'http://127.0.0.1:55439'
const dbArgs = [
  'exec',
  '-i',
  'evolutus_homolog_db',
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
const sql = (input) =>
  execFileSync('docker', dbArgs, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
const good = (result) => {
  assert.equal(result.error, null)
  return result.data
}
const gateway = await startAudGateway()
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, jwt({ role: 'service_role' }), options)
const [sa, ordinary, cat, otherCat] = Array.from({ length: 4 }, () => randomUUID())
const asAdmin = createClient(
  url,
  jwt({ role: 'authenticated', sub: sa, aud: 'authenticated' }),
  options
)
const asUser = createClient(
  url,
  jwt({ role: 'authenticated', sub: ordinary, aud: 'authenticated' }),
  options
)
const checks = []
const check = (value, name) => {
  assert.ok(value, name)
  checks.push(name)
  console.log(`PASS ${name}`)
}
const setIds = []
async function handler(name) {
  const { outputFiles } = await build({
    entryPoints: [`supabase/functions/${name}/index.ts`],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'real-supabase',
        setup(b) {
          b.onResolve({ filter: /^jsr:@supabase\/supabase-js/ }, () => ({
            path: 'client',
            namespace: 'real',
          }))
          b.onLoad({ filter: /.*/, namespace: 'real' }, () => ({
            contents: 'export const createClient = globalThis.__visualCreateClient',
          }))
        },
      },
    ],
  })
  globalThis.__visualCreateClient = createClient
  let serve
  globalThis.Deno = {
    env: {
      get: (name) =>
        ({
          SUPABASE_URL: url,
          SUPABASE_ANON_KEY: jwt({ role: 'anon' }),
          SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role' }),
        })[name],
    },
    serve: (fn) => {
      serve = fn
    },
  }
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
  return serve
}
async function call(fn, id, uid = sa) {
  const response = await fn(
    new Request('https://local.test/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt({ role: 'authenticated', sub: uid, aud: 'authenticated' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ visualSetId: id }),
    })
  )
  return { status: response.status, body: await response.json() }
}
async function allocate() {
  const set = good(
    await asAdmin.rpc('allocate_exercise_visual_set', {
      p_catalog_id: cat,
      p_generation_source: 'manual_upload',
      p_request_id: randomUUID(),
    })
  )
  setIds.push(set.visualSetId)
  return set
}
await ensureVisualTestFixtures()
const files = Object.fromEntries(
  await Promise.all(
    ['start', 'end', 'thumbnail'].map(async (role) => [
      role,
      await readFile(`/tmp/exercise-visual-fixtures/${role === 'thumbnail' ? 'thumb' : role}.webp`),
    ])
  )
)
async function upload(set) {
  for (const role of ['start', 'end', 'thumbnail'])
    good(
      await asAdmin.storage
        .from('exercise-visual-drafts')
        .upload(set.assets[role].path, files[role], { contentType: 'image/webp' })
    )
}
function session(input) {
  const child = spawn('docker', dbArgs)
  let output = '',
    err = ''
  let heldResolve
  const held = new Promise((resolve) => (heldResolve = resolve))
  child.stdout.on('data', (b) => {
    output += b
    if (output.includes('VISUAL_LOCK_HELD')) heldResolve()
  })
  child.stderr.on('data', (b) => (err += b))
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(err))))
  })
  child.stdin.end(input)
  return { held, done }
}
try {
  assert.equal(sql('select current_database()'), 'postgres')
  assert.equal(sql("select current_setting('cron.launch_active_jobs')"), 'off')
  for (const id of [sa, ordinary])
    good(
      await admin.auth.admin.createUser({
        id,
        email: `visual-delete-${id}@example.invalid`,
        password: 'Synthetic-Visual-913!',
        email_confirm: true,
      })
    )
  sql(
    `update public.users set role='superadmin' where id='${sa}'; insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions) values('${cat}','evolutus_dataset','delete-${cat}','Visual deletion integration','peito',array['peito'],'forca',array['Puxe.']),('${otherCat}','evolutus_dataset','delete-${otherCat}','Reference integration','peito',array['peito'],'forca',array['Puxe.']);`
  )
  const confirm = await handler('exercise-visual-confirm'),
    publish = await handler('publish-exercise-visual'),
    remove = await handler('delete-exercise-visual')
  const first = await allocate()
  await upload(first)
  assert.equal((await call(confirm, first.visualSetId)).status, 200)
  check(true, 'real WebP upload and server confirmation produce review')
  assert.equal((await call(publish, first.visualSetId)).status, 200)
  check(
    !!(await asAdmin.rpc('request_exercise_visual_deletion', { p_set_id: first.visualSetId }))
      .error,
    'published version blocked without touching public files'
  )
  check(
    (await call(remove, first.visualSetId, ordinary)).status === 403,
    'ordinary JWT cannot invoke deletion Edge Function'
  )
  const discarded = await allocate()
  await upload(discarded)
  assert.equal((await call(confirm, discarded.visualSetId)).status, 200)
  const publicPath = `${cat}/v${discarded.version}/start.webp`
  good(
    await admin.storage
      .from('exercise-visuals')
      .upload(publicPath, files.start, { contentType: 'image/webp' })
  )
  // Shared reference held by another committed transaction blocks deletion.
  const holder = session(
    `begin; update public.exercise_catalog set published_media_refs='{"images":[{"path":"${publicPath}"}]}' where id='${otherCat}';\n\\echo VISUAL_LOCK_HELD\nselect pg_sleep(0.6); commit;`
  )
  await holder.held
  const blocked = await asAdmin.rpc('request_exercise_visual_deletion', {
    p_set_id: discarded.visualSetId,
  })
  await holder.done
  check(
    blocked.error?.message === 'VISUAL_FILE_REFERENCED',
    'concurrent active reference wins safely and blocks deletion'
  )
  sql(`update public.exercise_catalog set published_media_refs='{}' where id='${otherCat}';`)
  check(
    !!(await asUser.rpc('request_exercise_visual_deletion', { p_set_id: discarded.visualSetId }))
      .error,
    'ordinary user cannot request SQL deletion'
  )
  const requests = await Promise.all([
    asAdmin.rpc('request_exercise_visual_deletion', { p_set_id: discarded.visualSetId }),
    asAdmin.rpc('request_exercise_visual_deletion', { p_set_id: discarded.visualSetId }),
  ])
  requests.forEach(good)
  check(
    sql(
      `select count(*) from public.exercise_visual_deletions where visual_set_id='${discarded.visualSetId}'`
    ) === '1',
    'concurrent requests create exactly one durable job'
  )
  check(
    (await asAdmin.from('exercise_visual_sets').select('id').eq('id', discarded.visualSetId)).data
      .length === 0,
    'discarded version immediately leaves review'
  )
  const failedClient = {
    rpc: admin.rpc.bind(admin),
    storage: {
      from: () => ({ remove: async () => ({ error: { message: 'synthetic Storage offline' } }) }),
    },
  }
  const failed = await processVisualDeletions(failedClient, discarded.visualSetId)
  check(
    failed.pending === 1 &&
      sql(
        `select status from public.exercise_visual_deletions where visual_set_id='${discarded.visualSetId}'`
      ) === 'pending',
    'Storage failure persists retry state, never completion'
  )
  check(
    !(await admin.storage.from('exercise-visuals').download(publicPath)).error,
    'partial public copy survives until retry'
  )
  const response = await call(remove, discarded.visualSetId)
  check(
    response.body.complete === true,
    'real Storage API removes drafts and partial public copies before completion'
  )
  check(
    sql(
      `select count(*) from storage.objects where name like '${cat}/${discarded.visualSetId}/%' or name like '${cat}/v${discarded.version}/%'`
    ) === '0',
    'no metadata or files remain for deleted version'
  )
  check(
    !!(await admin.storage.from('exercise-visuals').download(publicPath)).error,
    'deleted public object no longer downloadable'
  )
  check(
    (await call(remove, discarded.visualSetId)).body.complete === true,
    'completed Edge retry idempotent'
  )
  check(
    !!(
      await admin.storage
        .from('exercise-visuals')
        .upload(publicPath, files.start, { contentType: 'image/webp' })
    ).error,
    'late Storage insertion fenced by durable tombstone'
  )
  const race = await allocate()
  await upload(race)
  assert.equal((await call(confirm, race.visualSetId)).status, 200)
  const queue = session(
    `begin; select set_config('request.jwt.claim.sub','${sa}',true); select public.request_exercise_visual_deletion('${race.visualSetId}');\n\\echo VISUAL_LOCK_HELD\nselect pg_sleep(0.6); commit;`
  )
  await queue.held
  const concurrentPublish = await call(publish, race.visualSetId)
  await queue.done
  check(
    concurrentPublish.status !== 200,
    'deletion versus in-flight publication never publishes deleted version'
  )
  check(
    (await call(remove, race.visualSetId)).body.complete === true,
    'publication race leaves no untracked orphan files'
  )
  const latest = await allocate()
  check(latest.version > race.version, 'new version cannot reuse any deleted public path')
  const publishedRow = good(
    await asAdmin.from('exercise_visual_sets').select('status').eq('id', first.visualSetId).single()
  )
  check(
    publishedRow.status === 'published',
    'existing published version and catalogue refs preserved'
  )
  await mkdir('/tmp/exercise-visual-tests', { recursive: true })
  await writeFile(
    '/tmp/exercise-visual-tests/integration.json',
    JSON.stringify({ localOnly: true, checks, passed: checks.length }, null, 2)
  )
} finally {
  // Synthetic fixture cleanup only. Never reuse these identifiers outside this local process.
  for (const id of setIds) {
    const rows = good(
      await admin
        .from('exercise_visual_assets')
        .select('storage_bucket,storage_path')
        .eq('visual_set_id', id)
    )
    for (const bucket of ['exercise-visual-drafts', 'exercise-visuals']) {
      const paths = rows
        .filter((row) => row.storage_bucket === bucket)
        .map((row) => row.storage_path)
      if (paths.length) good(await admin.storage.from(bucket).remove(paths))
    }
  }
  sql(
    `begin; delete from public.exercise_visual_deletions where catalog_id in ('${cat}','${otherCat}'); delete from public.exercise_catalog where id in ('${cat}','${otherCat}'); commit;`
  )
  for (const id of [sa, ordinary]) good(await admin.auth.admin.deleteUser(id))
  await new Promise((resolve) => gateway.close(resolve))
}
