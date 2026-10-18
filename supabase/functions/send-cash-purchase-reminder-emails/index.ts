// Worker da fila de lembretes de compra pendente, invocado por pg_cron a cada minuto
// (migration 20261105000004). Orquestração em processor.js (claim/send/finish), controle de
// acesso em handler.js, ambos testáveis sem Deno; esta função só monta os clients e envia ao
// Resend. Secrets: RESEND_API_KEY, CASH_REMINDER_FROM_ADDRESS, CASH_REMINDER_SUPPORT_EMAIL,
// APP_PUBLIC_URL e CASH_REMINDER_WORKER_SECRET (exigido no header
// X-Cash-Reminder-Worker-Secret -- a anon key do gateway é pública e não autoriza o
// processamento).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { createWorkerHandler } from './handler.js'
import { processCashPurchaseReminders } from './processor.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const CASH_REMINDER_FROM_ADDRESS = Deno.env.get('CASH_REMINDER_FROM_ADDRESS')
const CASH_REMINDER_SUPPORT_EMAIL = Deno.env.get('CASH_REMINDER_SUPPORT_EMAIL')
const APP_PUBLIC_URL = Deno.env.get('APP_PUBLIC_URL')
const CASH_REMINDER_WORKER_SECRET = Deno.env.get('CASH_REMINDER_WORKER_SECRET')

const resendReady = Boolean(
  RESEND_API_KEY && CASH_REMINDER_FROM_ADDRESS && CASH_REMINDER_SUPPORT_EMAIL && APP_PUBLIC_URL
)
if (!resendReady) {
  console.error(
    '[CashReminder] missing RESEND_API_KEY/CASH_REMINDER_FROM_ADDRESS/CASH_REMINDER_SUPPORT_EMAIL/APP_PUBLIC_URL'
  )
}

Deno.serve(createWorkerHandler({
  workerSecret: CASH_REMINDER_WORKER_SECRET,
  resendReady,
  logError: (...args: unknown[]) => console.error(...args),
  run: () => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!)
    return processCashPurchaseReminders(admin, {
      resendApiKey: RESEND_API_KEY,
      fromAddress: CASH_REMINDER_FROM_ADDRESS,
      supportEmail: CASH_REMINDER_SUPPORT_EMAIL,
      appUrl: APP_PUBLIC_URL,
    })
  },
}))
