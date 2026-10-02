// Equivalente a processDeletionJobs (Cloud Function agendada, functions/index.js) --
// invocada por pg_cron a cada minuto (ver migration 20260930000002_deletion_worker.sql).
// A orquestração (listar jobs, chamar run_deletion_job, limpar Storage/Auth e confirmar o
// Auth) mora em processor.js, testável sem Deno; esta função só monta o client com a service
// role key. Nunca chamada pelo cliente (sem Authorization de usuário aqui, só o gate da anon
// key do próprio agendamento) -- toda ação usa a service role key.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { processDeletionJobs } from './processor.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (_req) => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { ok, error, ...summary } = await processDeletionJobs(admin)
  if (!ok) return jsonResponse({ error }, 500)
  return jsonResponse(summary)
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status })
}
