// Concorrência REAL: vários workers disputando a mesma outbox em um Postgres de verdade.
// Pulado por padrão (não há banco no CI); rode com:  PG_TEST_CONTAINER=pgtest npm run test:functions
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { processPushOutbox } from './processor.js'

const CONTAINER = process.env.PG_TEST_CONTAINER
const USER = 'c0000000-0000-0000-0000-000000000001'
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'])
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err || out))))
    child.stdin.end(sql)
  })
}

const admin = {
  rpc: async (name, args) => {
    try {
      if (name === 'claim_push_jobs') {
        const out = await psql(`select coalesce(json_agg(t), '[]'::json) from public.claim_push_jobs(${lit(args.p_worker_id)}, ${args.p_limit}) t`)
        return { data: JSON.parse(out), error: null }
      }
      await psql(`select public.${name}(${lit(args.p_worker_id)}, ${lit(JSON.stringify(args.p_results))}::jsonb)`)
      return { data: null, error: null }
    } catch (error) { return { data: null, error } }
  },
}

test('6 workers em paralelo: cada entrega (notificação x dispositivo) sai exatamente uma vez',
  { skip: !CONTAINER && 'defina PG_TEST_CONTAINER para rodar contra um Postgres real', timeout: 120000 },
  async () => {
    await psql(`delete from auth.users where id = '${USER}'`)
    await psql(`
      insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${USER}', 'authenticated', 'authenticated', 'concurrency@example.invalid', 'x', now(), '{}', '{}', now(), now());
      select set_config('request.jwt.claim.sub', '${USER}', false);
      select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/conc-' || n, repeat('p', 32), repeat('a', 16), 'ua', 'd' || n, 'android') from generate_series(1, 3) n;
      insert into public.notifications (recipient_id, type, metadata, dedupe_key)
        select '${USER}', 'admin_broadcast', jsonb_build_object('title', 'T' || g, 'body', 'B'), 'conc-' || g from generate_series(1, 40) g;
      update public.notification_push_outbox set next_attempt_at = now() where user_id = '${USER}';`)
    try {
      const sends = new Map()
      const provider = async (subscription, payload) => {
        const key = `${payload.notificationId}:${subscription.endpoint.split('/').pop()}`
        sends.set(key, (sends.get(key) || 0) + 1)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      const drain = async (workerId) => {
        let claimed = 0
        for (let round = 0; round < 12; round += 1) {
          const result = await processPushOutbox(admin, provider, { workerId, limit: 7 })
          claimed += result.claimed
          if (result.claimed === 0) break
        }
        return claimed
      }
      const claimedByWorker = await Promise.all(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(drain))
      const duplicates = [...sends.entries()].filter(([, count]) => count > 1)
      assert.deepEqual(duplicates, [], 'nenhuma entrega foi enviada mais de uma vez')
      assert.equal(sends.size, 120, '40 notificações x 3 dispositivos = 120 entregas, todas enviadas')
      assert.equal(claimedByWorker.reduce((a, b) => a + b, 0), 120, 'a soma dos claims dos workers é exatamente 120')
      assert.ok(claimedByWorker.filter((n) => n > 0).length >= 2, 'o trabalho foi realmente dividido entre workers')
      assert.equal(await psql(`select count(*) from public.notification_push_outbox where user_id = '${USER}' and status = 'sent'`), '40')
      assert.equal(await psql(`select count(*) from public.notification_push_outbox where status = 'processing'`), '0', 'nenhum job preso em processing')

      // novo ciclo (retry do cron): nada novo para enviar
      const again = await Promise.all(['w7', 'w8'].map((id) => processPushOutbox(admin, provider, { workerId: id })))
      assert.deepEqual(again.map((r) => r.claimed), [0, 0], 'reprocessar não reenvia nada')
      assert.equal(sends.size, 120)
    } finally {
      await psql(`delete from auth.users where id = '${USER}'`)
    }
  })
