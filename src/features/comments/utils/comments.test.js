import assert from 'node:assert/strict'
import test from 'node:test'
import { mapCommentRow } from '../api/comments.api.js'
import { commentPlaceholder, mergeCommentPage } from './comments.js'
import { commentDraftKey } from './drafts.js'

test('mergeCommentPage preserves order and removes duplicate ids', () => {
  const current = [{ id: 'a' }, { id: 'b' }]
  const page = [{ id: 'b' }, { id: 'c' }]
  assert.deepEqual(
    mergeCommentPage(current, page).map((item) => item.id),
    ['a', 'b', 'c']
  )
})

test('comment placeholders do not expose removed content', () => {
  assert.equal(commentPlaceholder('deleted_by_author'), 'Comentário excluído.')
  assert.equal(commentPlaceholder('removed_by_moderation'), 'Comentário removido pela moderação.')
})

test('draft keys isolate root and each reply composer', () => {
  assert.equal(commentDraftKey('post-1'), 'evolutus:comment-draft:post-1:root')
  assert.equal(commentDraftKey('post-1', 'parent-1'), 'evolutus:comment-draft:post-1:parent-1')
})

test('RPC mutation rows do not erase previously loaded author data', () => {
  const mapped = mapCommentRow({
    id: 'comment-1',
    status_id: 'status-1',
    author_id: 'user-1',
    parent_comment_id: null,
    root_comment_id: 'comment-1',
    ancestor_ids: [],
    depth: 0,
    body: 'Texto',
    status: 'active',
    reply_count: 0,
    like_count: 0,
    score: 0,
    created_at: '2026-10-02T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    edited_at: null,
  })

  assert.equal(Object.hasOwn(mapped, 'authorUsername'), false)
  assert.equal(Object.hasOwn(mapped, 'authorAvatarPath'), false)
})
