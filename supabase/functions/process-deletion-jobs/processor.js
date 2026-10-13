import { processStorageCleanup } from './storage-cleanup.js'

// Orquestração do worker de exclusão, SEM dependência de Deno -- importável por node --test
// (ver processor.test.js), no mesmo padrão de exercise-catalog-proxy/validation.js. `admin` é
// o client do Supabase com a service role key (ou um fake nos testes).
//
// Toda a lógica de linhas (o que apagar, portão financeiro) mora na RPC run_deletion_job; aqui
// só entra o que SQL não alcança (Storage e Auth). Convergência do Auth: depois que o banco é
// limpo o job fica em 'auth_cleanup' e só vira 'complete' quando confirm_auth_deletion é
// chamada -- ou seja, só depois de auth.admin.deleteUser confirmar (ou o usuário já não
// existir). Qualquer falha antes disso deixa o job em auth_cleanup; o próximo ciclo do cron
// o reentrega (run_deletion_job nesse estado não toca em tabela nenhuma) e tenta de novo.

export const STATUS_PHOTOS_BUCKET = 'status-photos'
export const PROFILE_AVATARS_BUCKET = 'profile-avatars'

// "Usuário já inexistente no Auth" é sucesso (idempotência do retry / exclusão feita por outro caminho).
export function isAuthUserAlreadyGone(error) {
  return error?.status === 404 || error?.code === 'user_not_found'
}

export async function processDeletionJobs(admin, log = console) {
  let jobs
  try {
    const { data, error } = await admin.rpc('list_pending_deletion_jobs')
    if (error) throw new Error('LIST_FAILED')
    jobs = data
  } catch {
    log.error('[process-deletion-jobs] list_pending_deletion_jobs failed')
    await processStorageCleanup(admin, log)
    return { ok: false, error: 'INTERNAL_ERROR' }
  }

  const summary = { queued: jobs?.length || 0, processed: 0, blocked: 0, errored: 0 }

  for (const job of jobs || []) {
    try {
      const { data: result, error: runError } = await admin.rpc('run_deletion_job', {
        p_job_id: job.id,
      })
      if (runError) {
        summary.errored++
        log.error('[process-deletion-jobs] run_deletion_job failed:', job.id)
        continue
      }
      // Falha do corpo da exclusão: já gravada em last_error pela própria RPC; job segue pending.
      if (result?.error) {
        summary.errored++
        log.error('[process-deletion-jobs] job failed (last_error persisted):', job.id)
        continue
      }
      if (result?.blocked) {
        summary.blocked++
        continue
      }
      if (!result?.complete && !result?.authPending) continue

      // Photos and avatars are captured by deletion triggers in the same transaction.
      // Cleanup runs independently below, even when deletion jobs are already complete.
      if (result.deleteAuthUser) {
        const { error: authError } = await admin.auth.admin.deleteUser(result.targetId)
        if (authError && !isAuthUserAlreadyGone(authError)) {
          summary.errored++
          log.error('[process-deletion-jobs] auth.admin.deleteUser failed (will retry):', job.id)
          try {
            // await em try/catch (não .catch): o builder de rpc do supabase-js é PromiseLike, sem .catch garantido.
            await admin.rpc('record_deletion_job_error', {
              p_job_id: job.id,
              p_error: `auth.admin.deleteUser: ${Number(authError.status) || 'unknown'}`,
            })
          } catch {
            log.error('[process-deletion-jobs] record_deletion_job_error:', job.id)
          }
          continue
        }

        const { error: confirmError } = await admin.rpc('confirm_auth_deletion', {
          p_job_id: job.id,
        })
        if (confirmError) {
          // Auth já removido mas job ainda em auth_cleanup: o próximo ciclo repete (404 = sucesso).
          summary.errored++
          log.error('[process-deletion-jobs] confirm_auth_deletion failed (will retry):', job.id)
          continue
        }
      }
      summary.processed++
    } catch {
      summary.errored++
      log.error('[process-deletion-jobs] unexpected error:', job.id)
    }
  }

  Object.assign(summary, await processStorageCleanup(admin, log))
  log.log(JSON.stringify({ event: 'process_deletion_jobs', ...summary }))
  return { ok: true, ...summary }
}
