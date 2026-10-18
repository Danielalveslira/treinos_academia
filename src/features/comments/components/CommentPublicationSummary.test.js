import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let renderSummary

const base = {
  id: 'status-1',
  communityId: 'community-1',
  authorUsername: 'ana',
  createdAt: '2026-10-02T12:00:00Z',
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'comment-summary-tests-'))
  const outfile = join(directory, 'summary.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { CommentPublicationSummary } from './CommentPublicationSummary.jsx'
        export const renderSummary = (status, authorAvatarPath) => renderToStaticMarkup(
          createElement(MemoryRouter, null,
            createElement(CommentPublicationSummary, { status, communityName: 'Academia', authorAvatarPath })
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
            contents: `import { createElement } from 'react'; export const ProfileAvatar = ({ path, name }) => createElement('span', {'data-avatar': true, 'data-avatar-path': path || '', 'data-avatar-name': name || ''})`,
          }))
        },
      },
    ],
  })
  ;({ renderSummary } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('summary links to the canonical card anchor of every publication type', () => {
  const workout = renderSummary({
    ...base,
    type: 'workout',
    workout: { title: 'Pernas', date: '2026-10-05T10:00:00Z', location: 'Academia X' },
  })
  assert.match(workout, /Treino marcado/)
  assert.match(workout, /href="\/comunidades\/community-1#treino-status-1"/)
  assert.match(workout, />Ver publicação</)

  const cases = {
    text: { text: 'Olá, pessoal' },
    achievement: { achievement: { text: 'Novo PR' } },
    poll: { poll: { question: 'Qual treino?' } },
    photo: { caption: 'Foto do treino' },
  }
  for (const [type, extra] of Object.entries(cases)) {
    const html = renderSummary({ ...base, type, ...extra })
    assert.match(html, /href="\/comunidades\/community-1#publicacao-status-1"/)
  }
})

test('the author avatar path reaches ProfileAvatar (regression: used to render with no path at all)', () => {
  const withAvatar = renderSummary(
    { ...base, type: 'text', text: 'Olá, pessoal' },
    'avatars/ana.webp'
  )
  assert.match(withAvatar, /data-avatar-path="avatars\/ana\.webp"/)
  assert.match(withAvatar, /data-avatar-name="ana"/)
})

test('an author with no avatar passes an empty path, never a broken or invented URL', () => {
  const noAvatar = renderSummary({ ...base, type: 'text', text: 'Olá, pessoal' }, null)
  assert.match(noAvatar, /data-avatar-path=""/)

  const undefinedAvatar = renderSummary({ ...base, type: 'text', text: 'Olá, pessoal' })
  assert.match(undefinedAvatar, /data-avatar-path=""/)
})

test('summary shows the key information of each type', () => {
  assert.match(renderSummary({ ...base, type: 'text', text: 'Olá, pessoal' }), /Olá, pessoal/)
  assert.match(
    renderSummary({ ...base, type: 'poll', poll: { question: 'Qual treino?' } }),
    /Qual treino\?/
  )
  assert.match(
    renderSummary({ ...base, type: 'achievement', achievement: { text: 'Novo PR' } }),
    /Novo PR/
  )
})
