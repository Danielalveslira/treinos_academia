// Worker da outbox de Web Push, invocado por pg_cron a cada minuto (migration
// 20261012000001_web_push_notifications.sql). A orquestração (claim, envio, classificação de
// erro, finalização) mora em processor.js, testável sem Deno; esta função só monta os clients.
// As chaves VAPID são secrets da função: a privada nunca sai daqui.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { processPushOutbox } from './processor.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')

const SEND_TIMEOUT_MS = 10000

// Sem configuração completa o worker nem faz claim: os jobs continuam pendentes na outbox (o
// rollback operacional do Push é justamente não processá-los) em vez de falharem em massa.
let vapidReady = false
if (SUPABASE_URL && SERVICE_ROLE_KEY && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    vapidReady = true
  } catch {
    console.error('[Push] invalid VAPID configuration')
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405)
  if (!vapidReady) return jsonResponse({ error: 'PUSH_NOT_CONFIGURED' }, 503)
  try {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!)
    const summary = await processPushOutbox(admin, (subscription, payload) =>
      webpush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 3600,
        urgency: 'normal',
        timeout: SEND_TIMEOUT_MS,
      })
    )
    return jsonResponse(summary)
  } catch (error) {
    // Só o código/nome do erro: mensagens do provedor podem conter o endpoint da subscription.
    console.error('[Push] worker failed', (error as { code?: string; name?: string })?.code ?? (error as Error)?.name)
    return jsonResponse({ error: 'PUSH_WORKER_FAILED' }, 500)
  }
})
