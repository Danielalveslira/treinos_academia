// Specific outbox: canonical draft/public paths, durable leases, Storage API + absence confirmation.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FILES = ['start.webp', 'end.webp', 'thumb.webp']
export function deletionFiles(job) {
  if (
    !UUID.test(job.catalog_id) ||
    !UUID.test(job.visual_set_id) ||
    !Number.isInteger(job.version) ||
    job.version < 1
  )
    return null
  const expected = ['exercise-visual-drafts', 'exercise-visuals'].flatMap((bucket) =>
    FILES.map((file) => ({
      bucket,
      path: `${job.catalog_id}/${bucket === 'exercise-visuals' ? `v${job.version}` : job.visual_set_id}/${file}`,
    }))
  )
  if (
    !Array.isArray(job.files) ||
    job.files.length !== expected.length ||
    expected.some(
      (file) =>
        job.files.filter((actual) => actual.bucket === file.bucket && actual.path === file.path)
          .length !== 1
    )
  )
    return null
  return expected
}

export function objectMissing(error) {
  return (
    ['NoSuchKey', 'ObjectNotFound'].includes(error?.code) ||
    (error?.message === 'Object not found' &&
      ['400', '404'].includes(String(error?.statusCode ?? error?.status)))
  )
}

export async function processVisualDeletions(admin, setId = null) {
  const summary = { completed: 0, pending: 0 }
  const { data: jobs, error } = await admin.rpc('claim_exercise_visual_deletions', {
    p_set_id: setId,
    p_limit: 20,
  })
  if (error || !Array.isArray(jobs)) throw new Error('DELETION_CLAIM_FAILED')
  for (const job of jobs) {
    let failure = null
    const files = deletionFiles(job)
    if (!files) failure = 'INVALID_REFERENCE'
    else {
      try {
        for (const bucket of ['exercise-visual-drafts', 'exercise-visuals']) {
          const paths = files.filter((file) => file.bucket === bucket).map((file) => file.path)
          const removal = await admin.storage.from(bucket).remove(paths)
          if (!removal || removal.error) throw new Error('STORAGE_RETRY')
          const checks = await Promise.all(
            paths.map((path) => admin.storage.from(bucket).download(path))
          )
          if (checks.some((check) => check.data || !objectMissing(check.error)))
            throw new Error('ABSENCE_UNCONFIRMED')
        }
      } catch {
        failure = 'STORAGE_RETRY'
      }
    }
    const result = await admin.rpc('finish_exercise_visual_deletion', {
      p_set_id: job.visual_set_id,
      p_token: job.lease_token,
      p_error: failure,
    })
    if (result.error || result.data !== true || failure) summary.pending++
    else summary.completed++
  }
  return summary
}
