import test from 'node:test'
import assert from 'node:assert/strict'
import {
  finalizedOperationResult,
  resolveAuthorizedAvatar,
} from '../../supabase/functions/finalize-professional-listing-publish/publishState.js'

test('finalize retry for the same completed operation is idempotent', () => {
  assert.deepEqual(
    finalizedOperationResult(
      { id: 'listing-1', lifecycle_state: 'published', published_version: 3 },
      { publish_operation_id: 'operation-1' },
      'operation-1'
    ),
    {
      listingId: 'listing-1',
      state: 'published',
      version: 3,
      repeated: true,
    }
  )
})

test('a different or unfinished operation is never reported as finalized', () => {
  assert.equal(
    finalizedOperationResult(
      { id: 'listing-1', lifecycle_state: 'published', published_version: 3 },
      { publish_operation_id: 'operation-1' },
      'operation-2'
    ),
    null
  )
  assert.equal(
    finalizedOperationResult(
      { id: 'listing-1', lifecycle_state: 'draft', published_version: 0 },
      { publish_operation_id: null },
      'operation-1'
    ),
    null
  )
})

test('publish without an authorized avatar sends no media reference', () => {
  assert.deepEqual(
    resolveAuthorizedAvatar(
      { kind: 'professional', use_profile_avatar: false },
      { avatar_media_id: 'media-1', avatar_path: 'owner/avatar.webp' }
    ),
    { avatarPath: null, avatarSourceMediaId: null }
  )
})

test('publish with an authorized avatar sends the exact current media reference', () => {
  assert.deepEqual(
    resolveAuthorizedAvatar(
      { kind: 'professional', use_profile_avatar: true },
      { avatar_media_id: 'media-1', avatar_path: 'owner/avatar.webp' }
    ),
    { avatarPath: 'owner/avatar.webp', avatarSourceMediaId: 'media-1' }
  )
})
