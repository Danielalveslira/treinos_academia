import { readFileSync } from 'node:fs'
// Real isolated PostgreSQL + actual worker + actual SW code in VM. Provider delivery is simulated.
import test from 'node:test'
import process from 'node:process'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { processPushOutbox } from './processor.js'
const authSessionFixture = readFileSync(new URL('../../tests/_helpers/auth_session.sql', import.meta.url), 'utf8')
const container = process.env.PG_TEST_CONTAINER
const uid = 'd3000000-0000-0000-0000-000000000001'
const otherUid = 'd3000000-0000-0000-0000-000000000002'
const endpoint = 'https://fcm.googleapis.com/fcm/send/activation-race'
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`
function sql(input) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      process.env.PG_TEST_USER || 'supabase_admin',
      '-d',
      'postgres',
      '-X',
      '-q',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
    ])
    let out = '',
      err = ''
    p.stdout.on('data', (x) => {
      out += x
    })
    p.stderr.on('data', (x) => {
      err += x
    })
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err))))
    p.stdin.end(authSessionFixture + '\n' + input)
  })
}
async function setup() {
  await sql(`delete from auth.users where id in (${lit(uid)},${lit(otherUid)});
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values (${lit(uid)},'authenticated','authenticated','activation-race@example.invalid','x',now(),'{}','{}',now(),now()),
      (${lit(otherUid)},'authenticated','authenticated','activation-other@example.invalid','x',now(),'{}','{}',now(),now());
    update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now() from public.legal_policy p where p.id and u.id in (${lit(uid)},${lit(otherUid)});`)
}
async function activate(user = uid, target = endpoint) {
  return JSON.parse(
    await sql(
      `set role authenticated; do $$begin perform pg_temp.set_test_user(${lit(user)},false); end$$; select public.activate_push_subscription(${lit(target)},repeat('p',32),repeat('a',16));`
    )
  )
}
const localOnly = {
  skip: !container && 'requires isolated PG_TEST_CONTAINER; never production',
  timeout: 120000,
}
test(
  'parallel activation -> one targeted outbox -> worker -> SW ACK and click; no repeat',
  localOnly,
  async () => {
    await setup()
    try {
      await sql(
        `do $$begin perform pg_temp.set_test_user(${lit(uid)},false); end$$; select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/other-device',repeat('p',32),repeat('a',16));`
      )
      const results = await Promise.all(Array.from({ length: 10 }, () => activate()))
      assert.equal(results.filter((x) => x.welcome === 'queued').length, 1)
      assert.equal(results.filter((x) => x.welcome === 'already_requested').length, 9)
      assert.ok(results.every((x) => x.status.thisDevice && x.status.enabled))
      assert.equal(
        await sql(`select count(*) from public.notification_push_outbox where user_id=${lit(uid)}`),
        '1'
      )
      const events = {},
        shown = [],
        opened = [],
        acks = []
      let template = await readFile(
        new URL('../../../scripts/service-worker.js', import.meta.url),
        'utf8'
      )
      for (const [key, value] of Object.entries({
        __VERSION__: 'integration',
        __SHELL_URLS__: '[]',
        __BOOT_ASSETS__: '[]',
        __OFFLINE_ASSETS__: '[]',
        __PUSH_ACK_URL__: JSON.stringify('https://local.invalid/ack'),
        __PUSH_ACK_KEY__: JSON.stringify('public-local-only'),
        __EXERCISE_VISUALS_PREFIX__: 'null',
      }))
        template = template.replace(key, value)
      const sw = {
        location: { origin: 'https://local.invalid' },
        addEventListener: (name, fn) => {
          events[name] = fn
        },
        registration: {
          showNotification: async (title, options) => {
            shown.push({ title, options })
          },
        },
        clients: {
          matchAll: async () => [],
          openWindow: async (url) => {
            opened.push(url)
          },
        },
      }
      vm.runInNewContext(template, {
        self: sw,
        URL,
        Promise,
        Date,
        Math,
        Number,
        AbortController,
        setTimeout,
        clearTimeout,
        fetch: async (_url, init) => {
          const a = JSON.parse(init.body)
          acks.push(a.p_event)
          await sql(`select public.push_delivery_ack(${lit(a.p_token)},${lit(a.p_event)});`)
          return { ok: true }
        },
      })
      const admin = {
        rpc: async (name, args) => {
          try {
            const output =
              name === 'claim_push_jobs'
                ? await sql(
                    `select coalesce(json_agg(t),'[]') from public.claim_push_jobs(${lit(args.p_worker_id)},${args.p_limit}) t;`
                  )
                : await sql(
                    `select public.finish_push_batch(${lit(args.p_worker_id)},${lit(JSON.stringify(args.p_results))}::jsonb);`
                  )
            return { data: name === 'claim_push_jobs' ? JSON.parse(output) : null, error: null }
          } catch (error) {
            return { error }
          }
        },
      }
      const sends = []
      const provider = async (subscription, payload, options) => {
        sends.push(subscription.endpoint)
        assert.equal(subscription.endpoint, endpoint)
        assert.ok(options.ttl > 0 && options.ttl <= 600)
        let done
        events.push({
          data: { json: () => payload },
          waitUntil: (p) => {
            done = p
          },
        })
        await done
        return { statusCode: 201 }
      }
      const workers = await Promise.all(
        ['wa', 'wb', 'wc'].map((workerId) => processPushOutbox(admin, provider, { workerId }))
      )
      assert.equal(
        workers.reduce((a, b) => a + b.sent, 0),
        1
      )
      assert.deepEqual(sends, [endpoint])
      assert.equal(shown.length, 1)
      assert.equal(shown[0].title, '💚 Boas-vindas ao Evolutus!')
      assert.equal(shown[0].options.data.targetUrl, '/app')
      let clicked
      events.notificationclick({
        notification: { data: shown[0].options.data, close: () => {} },
        waitUntil: (p) => {
          clicked = p
        },
      })
      await clicked
      // The authenticated application shell and the verified targetUrl above are /app.
      assert.deepEqual(opened, ['https://local.invalid/app'])
      assert.deepEqual(acks.sort(), ['clicked', 'received', 'shown'])
      assert.equal(
        await sql(
          `select count(*) from public.notification_push_deliveries d join public.notification_push_outbox o on o.id=d.outbox_id where o.user_id=${lit(uid)} and d.status='sent' and d.last_http_status=201 and d.sw_received_at is not null and d.show_resolved_at is not null and d.clicked_at is not null`
        ),
        '1'
      )
      assert.equal((await activate()).welcome, 'already_requested')
      assert.equal((await processPushOutbox(admin, provider, { workerId: 'repeat' })).claimed, 0)
      assert.equal(sends.length, 1)
    } finally {
      await sql(`delete from auth.users where id in (${lit(uid)},${lit(otherUid)});`)
    }
  }
)

test(
  'two accounts racing for an unowned endpoint cannot overwrite the winner',
  localOnly,
  async () => {
    await setup()
    try {
      const attempts = await Promise.allSettled([
        activate(uid, endpoint + '-owner'),
        activate(otherUid, endpoint + '-owner'),
      ])
      assert.equal(attempts.filter((x) => x.status === 'fulfilled').length, 1)
      const rejected = attempts.find((x) => x.status === 'rejected')
      assert.match(rejected.reason.message, /PUSH_ENDPOINT_IN_USE/)
      assert.equal(
        await sql(
          `select count(*) from public.push_subscriptions where endpoint=${lit(endpoint + '-owner')}`
        ),
        '1'
      )
      assert.equal(
        await sql(
          `select count(*) from public.notification_push_outbox where user_id in (${lit(uid)},${lit(otherUid)})`
        ),
        '1'
      )
    } finally {
      await sql(`delete from auth.users where id in (${lit(uid)},${lit(otherUid)});`)
    }
  }
)
