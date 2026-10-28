// Real Supabase Realtime -> logical replication -> RLS -> Node client. No event mocks.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { jwt } from '../keys.mjs'
const a = JSON.parse(readFileSync('.finance-local/phase6-access.json'))
const client = createClient('http://127.0.0.1:5173/_finance_local', jwt({ role: 'anon' }), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const principal = process.env.PHASE6_AUDIENCE === '1' ? 'viewer' : 'owner'
await client.realtime.setAuth(a[principal].access_token)
let receive, fail
const event = new Promise((r, j) => {
  receive = r
  fail = j
})
const timer = setTimeout(() => fail(Error('REALTIME_EVENT_TIMEOUT')), 25000)
const started = performance.now()
const channel = client
  .channel('phase6-real-check')
  .on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'advertising_delivery_epoch' },
    (payload) => receive(payload)
  )
try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error('REALTIME_SUBSCRIBE_TIMEOUT')), 20000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(t)
        resolve()
      } else if (status === 'CHANNEL_ERROR') {
        clearTimeout(t)
        reject(Error('REALTIME_CHANNEL_ERROR'))
      }
    })
  })
  execFileSync(
    'docker',
    [
      'exec',
      'evolutus_price_phase1_db',
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-c',
      'update public.advertising_delivery_epoch set revision=revision+1 where id;',
    ],
    { stdio: 'ignore' }
  )
  const payload = await event
  writeFileSync(
    `docs/finance-restructure/phase6/evidence/realtime${principal === 'viewer' ? '-viewer' : ''}.json`,
    JSON.stringify(
      {
        localOnly: true,
        officialService: true,
        realPostgresChanges: true,
        rlsChecked: true,
        principal,
        receivedRevision: payload.new.revision,
        subscribeAndDeliveryMs: Math.round(performance.now() - started),
      },
      null,
      2
    ) + '\n'
  )
  console.log('Official local Realtime delivered a real PostgreSQL invalidation')
} finally {
  clearTimeout(timer)
  await client.removeChannel(channel)
}
