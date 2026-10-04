// Worker da outbox de Web Push, invocado por pg_cron a cada minuto (migrations
// 20261012000001 e 20261012000003). A orquestração (claim, envio, classificação de erro,
// finalização) mora em processor.js e o controle de acesso em handler.js, ambos testáveis sem
// Deno; esta função só monta os clients.
// Secrets da função: VAPID_* (a privada nunca sai daqui) e PUSH_WORKER_SECRET, exigido no header
// X-Push-Worker-Secret. A anon key do gateway é pública e NÃO autoriza o processamento.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { createWorkerHandler } from './handler.js'
import { processPushOutbox } from './processor.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')
const PUSH_WORKER_SECRET = Deno.env.get('PUSH_WORKER_SECRET')

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

Deno.serve(createWorkerHandler({
  workerSecret: PUSH_WORKER_SECRET,
  vapidReady,
  logError: (...args: unknown[]) => console.error(...args),
  run: () => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!)
    return processPushOutbox(admin, (subscription: unknown, payload: unknown) =>
      webpush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 3600,
        urgency: 'normal',
        timeout: SEND_TIMEOUT_MS,
      })
    )
  },
}))
