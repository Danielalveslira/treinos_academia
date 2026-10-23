import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDate } from '../../../utils/format.js'
import {
  formatRelativeNotificationTime,
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

test('lembrete de treino varia na Central e leva ao fluxo planejado', () => {
  const first = { ...base, type: 'workout_reminder_before',
    actionUrl: '/novo-treino?planejado=2026-10-06', metadata: { variant: 0 } }
  const next = { ...first, metadata: { variant: 1 } }
  assert.notEqual(notificationContent(first).title, notificationContent(next).title)
  assert.equal(notificationHref(first), '/novo-treino?planejado=2026-10-06')
  assert.match(notificationContent({ ...first, type: 'workout_reminder_start' }).description, /horário/)
})

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

test('conteúdo dos eventos do pipeline único: curtida em publicação, economia, moderação e atendimento', () => {
  assert.equal(notificationContent({ ...base, type: 'post_like' }).title, '@ana curtiu sua publicação.')
  const coins = notificationContent({ ...base, type: 'economy_credit', metadata: { asset: 'coin', amount: 25, reason: 'admin_bonus' } })
  assert.equal(coins.title, 'Você recebeu 25 EvoCoins.')
  assert.equal(coins.description, 'Motivo: Bônus')
  const cash = notificationContent({ ...base, type: 'economy_credit', metadata: { asset: 'cash', amount: 120, reason: 'cash_purchase_confirmed' } })
  assert.equal(cash.title, 'Pagamento confirmado')
  assert.match(cash.description, /\+120 EvoCash/)
  const debit = notificationContent({ ...base, type: 'economy_debit', metadata: { asset: 'cash', amount: 5, reason: 'chargeback' } })
  assert.equal(debit.title, 'Ajuste na sua carteira')
  assert.match(debit.description, /5 EvoCash/)
  assert.equal(notificationContent({ ...base, type: 'moderation_notice', metadata: { action: 'remove_content' } }).title,
    'Um conteúdo seu foi removido pela moderação.')
  assert.equal(notificationContent({ ...base, type: 'report_resolved', metadata: { kind: 'appeal' } }).title, 'Seu recurso foi analisado.')
})

test('metadados inesperados caem em texto genérico (nunca HTML nem valores inventados)', () => {
  const weird = notificationContent({ ...base, type: 'economy_credit', metadata: { asset: 'coin', amount: 'DROP', reason: '<b>x</b>' } })
  assert.equal(weird.title, 'Você recebeu uma recompensa.')
  assert.equal(weird.description, undefined)
  assert.equal(notificationContent({ ...base, type: 'moderation_notice', metadata: { action: '<b>x</b>' } }).title, 'Você recebeu um aviso da moderação.')
})

test('formatRelativeNotificationTime: curta, com teto em "ontem" e virada para data absoluta', () => {
  const now = new Date('2026-10-08T10:00:00+00:00')
  assert.equal(formatRelativeNotificationTime('2026-10-08T09:59:40+00:00', now), 'agora')
  assert.equal(formatRelativeNotificationTime('2026-10-08T09:55:00+00:00', now), 'há 5 min')
  assert.equal(formatRelativeNotificationTime('2026-10-08T07:00:00+00:00', now), 'há 3 h')
  assert.equal(formatRelativeNotificationTime('2026-10-07T09:00:00+00:00', now), 'ontem')
  assert.equal(formatRelativeNotificationTime('2026-10-03T09:00:00+00:00', now), 'há 5 dias')
  assert.equal(formatRelativeNotificationTime('2026-09-01T09:00:00+00:00', now), formatDate(new Date('2026-09-01T09:00:00+00:00')))
  assert.equal(formatRelativeNotificationTime(null, now), '—')
})

test('deep links: curtida em publicação e eventos sem status usam o action_url do banco', () => {
  assert.equal(notificationHref({ ...base, type: 'post_like', actionUrl: '/comunidades/c1#publicacao-p1' }), '/comunidades/c1#publicacao-p1')
  assert.equal(notificationHref({ ...base, type: 'economy_credit', actionUrl: '/evocash' }), '/evocash')
  assert.equal(notificationHref({ ...base, type: 'moderation_notice', actionUrl: '/atendimento' }), '/atendimento')
  assert.equal(notificationHref({ ...base, type: 'post_like', actionUrl: '/\\evil.test' }), null)
})
