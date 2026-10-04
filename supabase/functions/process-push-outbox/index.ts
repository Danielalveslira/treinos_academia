import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { processPushOutbox } from './processor.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

Deno.serve(async () => {
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const summary = await processPushOutbox(admin, (subscription, payload) =>
      webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'normal' })
    )
    return Response.json(summary)
  } catch {
    console.error('[Push] worker failed')
    return Response.json({ error: 'PUSH_WORKER_FAILED' }, { status: 500 })
  }
})
