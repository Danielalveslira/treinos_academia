import { attempt, request, withTransaction } from './database.js'
import { STORES, userMetaKey } from './schema.js'
import { ACTIVE_KEY, LOGOUT_KEY } from './bootstrap.js'

export const SHEET_SNAPSHOT_TTL = 7 * 24 * 60 * 60 * 1000
const key = (uid) => userMetaKey(uid, 'sheet-snapshots')

export function validSheetSnapshot(row, uid, now = Date.now()) {
  return Boolean(
    row?.schema_version === 1 &&
    row.user_id === uid &&
    row.validated_at <= now &&
    now - row.validated_at < SHEET_SNAPSHOT_TTL &&
    row.sheet?.user_id === uid &&
    !row.sheet.archived_at &&
    row.sheet.items?.length > 0 &&
    row.sheet.items.length <= 40 &&
    row.sheet.items.every(
      (item) => item.available === true && item.exercise?.id === item.exercise_id
    )
  )
}

// The existing private metadata purge owns logout/account changes. A single bounded row,
// no images, no new store, and never any mutation/outbox deletion.
export function saveSheetSnapshot(uid, sheet, at = Date.now()) {
  const value = {
    schema_version: 1,
    user_id: uid,
    validated_at: at,
    sheet: {
      id: sheet?.id,
      user_id: sheet?.user_id,
      revision: sheet?.revision,
      name: sheet?.name,
      weekdays: sheet?.weekdays,
      archived_at: sheet?.archived_at,
      items: sheet?.items?.map((item) => ({
        exercise_id: item.exercise_id,
        available: item.available,
        target_sets: item.target_sets,
        reps_min: item.reps_min,
        reps_max: item.reps_max,
        rest_seconds: item.rest_seconds,
        target_duration_minutes: item.target_duration_minutes,
        target_distance_km: item.target_distance_km,
        note: item.note,
        exercise:
          item.exercise &&
          Object.fromEntries(
            [
              'id',
              'name',
              'muscleGroup',
              'type',
              'source',
              'active',
              'provider',
              'providerExerciseId',
              'catalogId',
            ].map((field) => [field, item.exercise[field]])
          ),
      })),
    },
  }
  if (!validSheetSnapshot(value, uid, at)) return Promise.resolve(false)
  return attempt(
    'sheet-snapshot:save',
    () =>
      withTransaction([STORES.syncMeta], 'readwrite', async ({ syncMeta }) => {
        const active = await request(syncMeta.get(ACTIVE_KEY))
        const logout = await request(syncMeta.get(LOGOUT_KEY))
        if (active?.value !== uid || (logout?.value?.userId === uid && logout.value.at >= at))
          return false
        const previous = await request(syncMeta.get(key(uid)))
        const rows = (previous?.value || []).filter(
          (row) => validSheetSnapshot(row, uid, at) && row.sheet.id !== sheet.id
        )
        rows.push(value)
        syncMeta.put({ key: key(uid), value: rows.slice(-40) })
        return true
      }),
    false
  )
}

export function readSheetSnapshots(uid, now = Date.now()) {
  return attempt(
    'sheet-snapshot:read',
    () =>
      withTransaction([STORES.syncMeta], 'readonly', async ({ syncMeta }) => {
        const active = await request(syncMeta.get(ACTIVE_KEY))
        if (active?.value !== uid) return []
        const row = await request(syncMeta.get(key(uid)))
        return (row?.value || [])
          .filter((value) => validSheetSnapshot(value, uid, now))
          .map((value) => ({
            ...value.sheet,
            offlineSnapshot: true,
            validatedAt: value.validated_at,
          }))
      }),
    []
  )
}

export function invalidateSheetSnapshots(uid) {
  return attempt(
    'sheet-snapshot:invalidate',
    () =>
      withTransaction([STORES.syncMeta], 'readwrite', ({ syncMeta }) => {
        syncMeta.delete(key(uid))
      }),
    undefined
  )
}
