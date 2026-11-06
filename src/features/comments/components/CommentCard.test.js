import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let renderComment

function makeComment(overrides = {}) {
  return {
    id: 'comment-1',
    statusId: 'status-1',
    authorId: 'author-1',
    authorUsername: 'ana',
    parentCommentId: null,
    rootCommentId: 'comment-1',
    ancestorIds: [],
    depth: 0,
    body: 'Texto do comentário',
    status: 'active',
    replyCount: 2,
    likeCount: 0,
    score: 0,
    createdAt: '2026-10-02T12:00:00Z',
    updatedAt: '2026-10-02T12:00:00Z',
    editedAt: null,
    likedByViewer: false,
    ...overrides,
  }
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'comment-card-tests-'))
  const outfile = join(directory, 'comment-card.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { CommentCard } from './CommentCard.jsx'
        export const renderComment = (comment, props = {}) => renderToStaticMarkup(
          createElement(ThemeProvider, null,
            createElement(BaseStyles, null,
              createElement(MemoryRouter, null,
                createElement(CommentCard, {
                  comment,
                  communityId: 'community-1',
                  currentUserId: 'viewer-1',
                  ...props,
                })
              )
            )
          )
        )
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
        name: 'avatar-stub',
        setup(context) {
          context.onResolve({ filter: /\/ProfileAvatar$/ }, () => ({
            path: 'avatar',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^avatar$/, namespace: 'stub' }, () => ({
            resolveDir: new URL('../../../', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
            contents: `import { createElement } from 'react'; export const ProfileAvatar = () => createElement('span', {'data-avatar': true})`,
          }))
        },
      },
    ],
  })
  ;({ renderComment } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('thread toggle exposes collapsed state and controls the reply region', () => {
  const html = renderComment(makeComment())
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-controls="respostas-comment-1"/)
  assert.match(html, /Ver 2 respostas/)
})

test('context mode reuses the card, offers lazy replies only for the opened comment and hides the permalink', () => {
  const html = renderComment(makeComment(), {
    contextMode: true,
    highlighted: true,
    replyingToUsername: 'bruno',
    showPermalink: false,
  })
  assert.match(html, /comment-card is-highlighted is-entering is-context/)
  assert.match(html, /respondeu a @bruno/)
  assert.match(html, /Ver 2 respostas/)
  assert.doesNotMatch(html, />Link</)
})

test('context mode ancestors do not repeat their reply branches', () => {
  const html = renderComment(makeComment(), { contextMode: true, showPermalink: false })
  assert.doesNotMatch(html, /Ver 2 respostas/)
})

test('removed content uses the safe placeholder and never renders the original body', () => {
  const html = renderComment(
    makeComment({ status: 'removed_by_moderation', body: 'conteúdo removido', replyCount: 0 })
  )
  assert.match(html, /Comentário removido pela moderação/)
  assert.doesNotMatch(html, /conteúdo removido/)
})

test('long links stay in the comment body for CSS wrapping without truncation', () => {
  const link = `https://example.com/${'segmento-'.repeat(30)}`
  const html = renderComment(makeComment({ body: link, replyCount: 0 }))
  assert.match(html, new RegExp(link.replaceAll('/', '\\/')))
})

test('superadmin badge appears on a comment, takes priority over community admin, and neither leaks to a plain user', () => {
  const superadmin = renderComment(
    makeComment({ authorIsSuperAdmin: true, authorIsCommunityAdmin: true, replyCount: 0 })
  )
  assert.match(superadmin, /aria-label="Superadmin"/)
  assert.doesNotMatch(superadmin, /aria-label="Administrador da comunidade"/)

  const admin = renderComment(
    makeComment({ authorIsSuperAdmin: false, authorIsCommunityAdmin: true, replyCount: 0 })
  )
  assert.match(admin, /aria-label="Administrador da comunidade"/)
  assert.doesNotMatch(admin, /aria-label="Superadmin"/)

  const plain = renderComment(makeComment({ replyCount: 0 }))
  assert.doesNotMatch(plain, /aria-label="Superadmin"|aria-label="Administrador da comunidade"/)
})
