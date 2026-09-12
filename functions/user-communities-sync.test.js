import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSyncUserCommunityIds } from './user-communities-sync.js'

function fakeDb(updateImpl) {
  return { doc: (path) => ({ update: (data) => updateImpl(path, data) }) }
}

const FieldValue = {
  arrayUnion: (v) => ({ op: 'arrayUnion', v }),
  arrayRemove: (v) => ({ op: 'arrayRemove', v }),
}

test('join adds the community id via arrayUnion on the right document', async () => {
  const calls = []
  const sync = createSyncUserCommunityIds({
    db: fakeDb((path, data) => calls.push({ path, data })),
    FieldValue,
  })
  await sync('user1', 'comm1', 'join')
  assert.deepEqual(calls, [
    { path: 'users/user1', data: { communityIds: { op: 'arrayUnion', v: 'comm1' } } },
  ])
})

test('leave removes the community id via arrayRemove', async () => {
  const calls = []
  const sync = createSyncUserCommunityIds({
    db: fakeDb((path, data) => calls.push({ path, data })),
    FieldValue,
  })
  await sync('user1', 'comm1', 'leave')
  assert.deepEqual(calls, [
    { path: 'users/user1', data: { communityIds: { op: 'arrayRemove', v: 'comm1' } } },
  ])
})

test('does nothing when userId or communityId is missing', async () => {
  const calls = []
  const sync = createSyncUserCommunityIds({
    db: fakeDb((path, data) => calls.push({ path, data })),
    FieldValue,
  })
  await sync(undefined, 'comm1', 'join')
  await sync('user1', undefined, 'join')
  assert.deepEqual(calls, [])
})

test('a failed update (e.g. deleted profile) is swallowed, not thrown', async () => {
  const sync = createSyncUserCommunityIds({
    db: fakeDb(() => {
      throw Object.assign(new Error('not-found'), { code: 'not-found' })
    }),
    FieldValue,
  })
  await assert.doesNotReject(sync('user1', 'comm1', 'join'))
})
