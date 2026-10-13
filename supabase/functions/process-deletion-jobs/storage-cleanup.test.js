import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePhotoPath,
  isStorageObjectAlreadyGone,
  processStorageCleanup,
} from './storage-cleanup.js'
const folder = '71000000-0000-0000-0000-000000000001'
const photo = '71000000-0000-0000-0000-000000000002'
const key = `${folder}/${photo}.webp`
const silent = { error() {} }

test('normalization: current DB reference, relative key, avatar, legacy-shaped prefix', () => {
  assert.equal(normalizePhotoPath(`statusPhotos/${key}`), key)
  assert.equal(normalizePhotoPath(key), key)
  assert.equal(normalizePhotoPath(key, 'profile-avatars'), key)
})
test('normalization refuses duplicate prefix, other buckets, URLs, traversal and malformed input', () => {
  for (const input of [
    null,
    undefined,
    3,
    {},
    [],
    '',
    ' ',
    `statusPhotos/statusPhotos/${key}`,
    `status-photos/${key}`,
    `profile-avatars/${key}`,
    `https://example.invalid/${key}`,
    `/${key}`,
    `${key}?token=secret`,
    `${key}\n`,
    key.toUpperCase(),
    key.replace('.webp', '.jpg'),
    `../${key}`,
    key.replace('/', '/%2e%2e/'),
    key.replace('/', '//'),
    key.replace('/', '\\'),
  ]) {
    assert.equal(normalizePhotoPath(input), null, String(input))
  }
  assert.equal(normalizePhotoPath(key, 'other'), null)
  assert.equal(normalizePhotoPath(`statusPhotos/${key}`, 'profile-avatars'), null)
})
function fake(
  tasks,
  remove = async () => ({ error: null }),
  finish = async () => ({ data: true })
) {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args })
      return name === 'claim_storage_cleanup_tasks' ? { data: tasks } : finish(args)
    },
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          calls.push({ bucket, paths })
          return remove(paths)
        },
      }),
    },
  }
}
const task = (extra = {}) => ({
  id: photo,
  bucket: 'status-photos',
  reference: `statusPhotos/${key}`,
  object_key: key,
  lease_token: folder,
  ...extra,
})
test('multiple photos: normalized bucket keys only, successes durably acknowledged', async () => {
  const admin = fake([task(), task({ id: folder, bucket: 'profile-avatars', reference: key })])
  assert.deepEqual(await processStorageCleanup(admin, silent), {
    cleanupQueued: 2,
    cleanupCompleted: 2,
    cleanupErrored: 0,
  })
  assert.deepEqual(
    admin.calls.filter((x) => x.bucket),
    [
      { bucket: 'status-photos', paths: [key] },
      { bucket: 'profile-avatars', paths: [key] },
    ]
  )
})
test('SDK error and rejected promise never count as completed; safe diagnostics', async () => {
  for (const remove of [
    async () => ({ error: { status: 503, message: 'personal-name token secret' } }),
    async () => {
      throw Error('token secret')
    },
  ]) {
    const admin = fake([task()], remove)
    const logs = []
    const result = await processStorageCleanup(admin, { error: (...args) => logs.push(args) })
    assert.equal(result.cleanupCompleted, 0)
    assert.equal(result.cleanupErrored, 1)
    assert.equal(admin.calls.at(-1).args.p_error, 'STORAGE_RETRY')
    assert.doesNotMatch(JSON.stringify(logs), /secret|personal-name/)
  }
})
test('object absence explicit is idempotent; generic 404/missing bucket is failure', async () => {
  for (const code of ['NoSuchKey', 'ObjectNotFound']) {
    assert.equal(isStorageObjectAlreadyGone({ code }), true)
    assert.equal(
      (
        await processStorageCleanup(
          fake([task()], async () => ({ error: { code } })),
          silent
        )
      ).cleanupCompleted,
      1
    )
  }
  for (const error of [{ status: 404 }, { code: 'NoSuchBucket' }, { status: 403 }]) {
    assert.equal(isStorageObjectAlreadyGone(error), false)
    assert.equal(
      (
        await processStorageCleanup(
          fake([task()], async () => ({ error })),
          silent
        )
      ).cleanupCompleted,
      0
    )
  }
})
test('invalid reference or scope mismatch never reaches Storage', async () => {
  for (const t of [
    task({ reference: `statusPhotos/statusPhotos/${key}` }),
    task({ object_key: `${folder}/${folder}.webp` }),
  ]) {
    const admin = fake([t])
    await processStorageCleanup(admin, silent)
    assert.equal(
      admin.calls.some((x) => x.bucket),
      false
    )
    assert.equal(admin.calls.at(-1).args.p_error, 'INVALID_REFERENCE')
  }
})
test('ack failure or stale token retains recoverability, never reports completion', async () => {
  for (const finish of [
    async () => ({ data: false }),
    async () => ({ error: { status: 503 } }),
    async () => {
      throw Error('down')
    },
  ]) {
    const result = await processStorageCleanup(fake([task()], undefined, finish), silent)
    assert.equal(result.cleanupCompleted, 0)
    assert.equal(result.cleanupErrored, 1)
  }
})
test('empty queue and claim failure', async () => {
  assert.equal((await processStorageCleanup(fake([]), silent)).cleanupCompleted, 0)
  const admin = fake([])
  admin.rpc = async () => ({ error: { message: 'secret' } })
  assert.equal((await processStorageCleanup(admin, silent)).cleanupErrored, 1)
})

test('explicit object absence in a rejected promise is also idempotent', async () => {
  const admin = fake([task()], async () => {
    throw { code: 'NoSuchKey' }
  })
  assert.equal((await processStorageCleanup(admin, silent)).cleanupCompleted, 1)
})
