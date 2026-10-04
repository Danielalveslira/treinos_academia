import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAdminNotification,
  mergeNotificationPage,
  newestCreatedAt,
  notificationContent,
  notificationCursor,
  notificationHref,
  safeActionUrl,
} from './notifications.js'

const base = {
  id: 1,
  actorUsername: 'ana',
  statusId: null,
  commentId: null,
  communityId: null,
  actionUrl: null,
  metadata: {},
  createdAt: '2026-10-08T10:00:00.5+00:00',
}

test('comment notifications keep the comment deep link', () => {
  const notification = {
    ...base,
    type: 'comment_reply',
    statusId: 's1',
    commentId: 'c1',
    communityId: 'com1',
  }
  assert.equal(notificationHref(notification), '/comunidades/com1/publicacoes/s1/comentarios/c1')
  assert.equal(notificationContent(notification).title, '@ana respondeu seu comentário.')
  assert.equal(isAdminNotification(notification), false)
})

test('admin notifications use the internal action url and never expose report content', () => {
  const notification = {
    ...base,
    type: 'admin_report',
    actionUrl: '/admin/moderacao',
    metadata: { kind: 'report', category: 'spam', target: 'comment', message: 'segredo' },
  }
  assert.equal(isAdminNotification(notification), true)
  assert.equal(notificationHref(notification), '/admin/moderacao')
  const content = notificationContent(notification)
  assert.equal(content.title, 'Nova denúncia aguardando análise')
  assert.equal(content.description, 'Comentário denunciado')
  assert.doesNotMatch(JSON.stringify(content), /segredo/)
})

test('moderation notifications describe the applied action', () => {
  const decision = notificationContent({
    ...base,
    type: 'admin_moderation_decision',
    metadata: { action: 'remove_content' },
  })
  assert.equal(decision.description, 'Conteúdo removido')
  const restriction = notificationContent({
    ...base,
    type: 'admin_restriction',
    metadata: { action: 'system_ban' },
  })
  assert.equal(restriction.title, 'Restrição aplicada')
  assert.equal(restriction.description, 'Banimento do sistema')
})

test('unknown types fall back to a generic message', () => {
  assert.equal(notificationContent({ ...base, type: 'future_type' }).title, 'Nova notificação')
})

test('safeActionUrl only accepts internal paths', () => {
  assert.equal(safeActionUrl('/admin/moderacao'), '/admin/moderacao')
  assert.equal(safeActionUrl('//evil.example'), null)
  assert.equal(safeActionUrl('/\\evil.example'), null)
  assert.equal(safeActionUrl('https://evil.example'), null)
  assert.equal(safeActionUrl('javascript:alert(1)'), null)
  assert.equal(safeActionUrl(null), null)
  assert.equal(notificationHref({ ...base, type: 'admin_report', actionUrl: 'https://x.y' }), null)
})

test('mergeNotificationPage removes duplicates and keeps order', () => {
  const merged = mergeNotificationPage([{ id: 3 }, { id: 2 }], [{ id: 2 }, { id: 1 }])
  assert.deepEqual(
    merged.map((item) => item.id),
    [3, 2, 1]
  )
})

test('cursor uses created_at and id of the last item', () => {
  assert.deepEqual(notificationCursor({ id: 7, createdAt: 'x' }), { createdAt: 'x', id: 7 })
})

test('newestCreatedAt bounds bulk actions by what the user has seen', () => {
  const all = [
    { createdAt: '2026-10-08T10:00:00.5+00:00' },
    { createdAt: '2026-10-08T09:00:00+00:00' },
  ]
  const unread = [{ createdAt: '2026-10-08T10:00:00.123456+00:00' }]
  assert.equal(newestCreatedAt(all, unread), '2026-10-08T10:00:00.5+00:00')
  assert.equal(newestCreatedAt([], undefined), null)
})
