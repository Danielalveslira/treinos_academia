// The DB checks the key against the deleted row's identity. The worker checks syntax again.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const KEY = new RegExp(`^${UUID}/${UUID}\\.webp$`)
// community-covers has no owner segment: one file per community, path is just "{id}.webp".
const SINGLE_SEGMENT_KEY = new RegExp(`^${UUID}\\.webp$`)
const TWO_SEGMENT_BUCKETS = ['status-photos', 'profile-avatars', 'storefront-media']
const SINGLE_SEGMENT_BUCKETS = ['community-covers']

export function normalizePhotoPath(reference, bucket = 'status-photos') {
  if (typeof reference !== 'string') return null
  if (TWO_SEGMENT_BUCKETS.includes(bucket)) {
    const key =
      bucket === 'status-photos' && reference.startsWith('statusPhotos/')
        ? reference.slice('statusPhotos/'.length)
        : reference
    return KEY.test(key) ? key : null
  }
  if (SINGLE_SEGMENT_BUCKETS.includes(bucket)) {
    return SINGLE_SEGMENT_KEY.test(reference) ? reference : null
  }
  return null
}

// Generic HTTP 404 can mean a missing bucket/route. Only an explicit object error is idempotent.
export function isStorageObjectAlreadyGone(error) {
  return ['NoSuchKey', 'ObjectNotFound'].includes(error?.code)
}

export async function processStorageCleanup(admin, log = console) {
  const summary = { cleanupQueued: 0, cleanupCompleted: 0, cleanupErrored: 0 }
  let tasks
  try {
    const { data, error } = await admin.rpc('claim_storage_cleanup_tasks')
    if (error || !Array.isArray(data)) throw new Error('CLAIM_FAILED')
    tasks = data
  } catch {
    log.error('[process-deletion-jobs] cleanup claim failed')
    return { ...summary, cleanupErrored: 1 }
  }
  summary.cleanupQueued = tasks.length
  for (const task of tasks) {
    let failure = null
    const key = normalizePhotoPath(task.reference, task.bucket)
    if (!key || key !== task.object_key) {
      failure = 'INVALID_REFERENCE'
    } else {
      try {
        const result = await admin.storage.from(task.bucket).remove([key])
        if (!result || (result.error && !isStorageObjectAlreadyGone(result.error)))
          failure = 'STORAGE_RETRY'
      } catch (error) {
        failure = isStorageObjectAlreadyGone(error) ? null : 'STORAGE_RETRY'
      }
    }
    try {
      const { data, error } = await admin.rpc('finish_storage_cleanup_task', {
        p_id: task.id,
        p_token: task.lease_token,
        p_error: failure,
      })
      if (error || data !== true) throw new Error('ACK_FAILED')
      if (failure) summary.cleanupErrored++
      else summary.cleanupCompleted++
    } catch {
      // Durable lease expires; a later invocation retries. Never acknowledge in memory.
      summary.cleanupErrored++
    }
  }
  if (summary.cleanupErrored) log.error('[process-deletion-jobs] cleanup remains outstanding')
  return summary
}
