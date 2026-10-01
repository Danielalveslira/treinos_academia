// Equivalente a processDeletionJobs (Cloud Function agendada, functions/index.js) --
// invocada por pg_cron a cada minuto (ver migration 20260930000002_deletion_worker.sql).
// Toda a lógica de linhas (o que apagar, o portão financeiro) mora na RPC
// run_deletion_job (SQL, uma transação por job) -- esta função só orquestra o que SQL
// não alcança: listar os jobs, chamar a RPC, e então limpar Storage/Auth com o resultado
// dela. Nunca chamada pelo cliente (sem Authorization de usuário aqui, só o gate da
// anon key do próprio agendamento) -- toda ação usa a service role key.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const STATUS_PHOTOS_BUCKET = 'status-photos'
const PROFILE_AVATARS_BUCKET = 'profile-avatars'

Deno.serve(async (_req) => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: jobs, error: listError } = await admin.rpc('list_pending_deletion_jobs')
  if (listError) {
    console.error('[process-deletion-jobs] list_pending_deletion_jobs failed:', listError)
    return jsonResponse({ error: 'INTERNAL_ERROR' }, 500)
  }

  let processed = 0
  let blocked = 0
  let errored = 0

  for (const job of jobs || []) {
    try {
      const { data: result, error: runError } = await admin.rpc('run_deletion_job', { p_job_id: job.id })
      if (runError) {
        errored++
        console.error('[process-deletion-jobs] run_deletion_job failed:', job.id, runError)
        continue
      }
      if (result?.blocked) {
        blocked++
        continue
      }
      if (!result?.complete) continue

      // Storage: mesma lógica de eraseStoragePrefix/photoPath do original -- nunca
      // trava o job por causa disso (o registro já está apagado no Postgres; um arquivo
      // órfão no Storage é limpável depois, não motivo pra reprocessar o job).
      const photoPaths: string[] = result.photoPaths || []
      if (photoPaths.length) {
        await admin.storage.from(STATUS_PHOTOS_BUCKET).remove(photoPaths).catch((error) =>
          console.error('[process-deletion-jobs] status photo cleanup:', job.id, error)
        )
      }
      if (result.deleteAuthUser) {
        await admin.storage.from(PROFILE_AVATARS_BUCKET).list(`${result.targetId}/`).then(
          async ({ data: files }) => {
            if (!files?.length) return
            await admin.storage
              .from(PROFILE_AVATARS_BUCKET)
              .remove(files.map((file) => `${result.targetId}/${file.name}`))
          }
        ).catch((error) => console.error('[process-deletion-jobs] avatar cleanup:', job.id, error))

        // Auth.admin.deleteUser é o único passo cuja falha realmente importa reportar --
        // sem isso, a conta continua conseguindo autenticar (mesmo com a linha em
        // public.users já apagada), então não silenciamos o erro como os de Storage.
        const { error: authError } = await admin.auth.admin.deleteUser(result.targetId)
        if (authError && authError.status !== 404) {
          errored++
          console.error('[process-deletion-jobs] auth.admin.deleteUser failed:', job.id, authError)
          continue
        }
      }
      processed++
    } catch (error) {
      errored++
      console.error('[process-deletion-jobs] unexpected error:', job.id, error)
    }
  }

  console.log(JSON.stringify({ event: 'process_deletion_jobs', queued: jobs?.length || 0, processed, blocked, errored }))
  return jsonResponse({ queued: jobs?.length || 0, processed, blocked, errored })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status })
}
