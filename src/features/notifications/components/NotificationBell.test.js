import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let renderItem
let renderBell

const base = {
  id: 1,
  actorUsername: 'ana',
  statusId: null,
  commentId: null,
  communityId: null,
  actionUrl: null,
  metadata: {},
  priority: 'normal',
  readAt: null,
  createdAt: '2026-10-08T10:00:00+00:00',
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'notification-bell-tests-'))
  const outfile = join(directory, 'bell.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { NotificationBell, NotificationItem } from './NotificationBell.jsx'
        const wrap = (child) => renderToStaticMarkup(
          createElement(ThemeProvider, null,
            createElement(BaseStyles, null, createElement(MemoryRouter, null, child))))
        export const renderItem = (notification) =>
          wrap(createElement(NotificationItem, { notification, onSelect: () => {} }))
        export const renderBell = () => wrap(createElement(NotificationBell))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'supabase-stub',
        setup(context) {
          context.onResolve({ filter: /\/supabase\/config(\.js)?$/ }, () => ({
            path: 'config',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^config$/, namespace: 'stub' }, () => ({
            contents: 'export const supabase = {}',
          }))
        },
      },
    ],
  })
  ;({ renderItem, renderBell } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('sino fechado não renderiza o popover nem carrega a lista', () => {
  const html = renderBell()
  assert.match(html, /aria-label="Notificações"/)
  assert.match(html, /aria-expanded="false"/)
  assert.doesNotMatch(html, /role="dialog"/)
  assert.doesNotMatch(html, /Marcar todas como lidas/)
})

test('não lida é destacada e anunciada; lida perde o destaque', () => {
  const unread = renderItem({ ...base, type: 'admin_report', actionUrl: '/admin/moderacao' })
  assert.match(unread, /notification-item is-unread/)
  assert.match(unread, /Não lida:/)
  assert.match(unread, /notification-dot/)
  const read = renderItem({
    ...base,
    type: 'admin_report',
    actionUrl: '/admin/moderacao',
    readAt: '2026-10-08T11:00:00+00:00',
  })
  assert.doesNotMatch(read, /is-unread/)
  assert.doesNotMatch(read, /notification-dot/)
})

test('prioridade alta recebe marcação discreta e o destino interno', () => {
  const html = renderItem({
    ...base,
    type: 'admin_restriction',
    priority: 'high',
    actionUrl: '/admin/moderacao',
    metadata: { action: 'system_ban' },
  })
  assert.match(html, /is-priority/)
  assert.match(html, /href="\/admin\/moderacao"/)
  assert.match(html, /Banimento do sistema/)
})

test('destino externo nunca vira link', () => {
  const html = renderItem({ ...base, type: 'admin_report', actionUrl: 'https://evil.example' })
  assert.doesNotMatch(html, /href=/)
  assert.match(html, /<button/)
})
