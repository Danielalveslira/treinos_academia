import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Como o card de progresso aparece no feed e nos comentários: uma foto normal com um rótulo discreto "Progresso".
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'progress-post-ui-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { PhotoStatus } from './PhotoStatus.jsx'
        import { CommentPublicationSummary } from '../features/comments/components/CommentPublicationSummary.jsx'
        const wrap = (child) => renderToStaticMarkup(createElement(ThemeProvider, null, createElement(BaseStyles, null, createElement(MemoryRouter, null, child))))
        export const photo = (status) => wrap(createElement(PhotoStatus, { status }))
        export const summary = (status) => wrap(createElement(CommentPublicationSummary, { status, communityName: 'Corrida' }))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    define: {
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'https://x.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'k',
        DEV: false,
      }),
    },
  })
  return createRequire(import.meta.url)(outfile)
}

const { photo, summary } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const base = {
  id: 's1',
  authorId: 'u1',
  authorUsername: 'ana',
  type: 'photo',
  photoPath: 'statusPhotos/c1/s1.webp',
  createdAt: '2026-10-02T12:00:00Z',
}
const progress = { kind: 'week', periodStart: '2026-09-28', periodEnd: '2026-10-04' }

test('a progress card shows the discreet "Progresso" tag in the feed; a regular photo does not', () => {
  assert.match(
    photo({ ...base, progress, caption: 'Semana concluída 💪' }),
    /status-progress-tag[^>]*>.*Progresso/s
  )
  assert.match(photo({ ...base, progress, caption: 'Semana concluída 💪' }), /Semana concluída 💪/)
  assert.doesNotMatch(photo({ ...base, progress: null, caption: 'Treino de perna' }), /Progresso/)
})

test('the feed never says "Conquista do dia" generically for a progress card', () => {
  assert.doesNotMatch(photo({ ...base, progress, caption: '' }), /Conquista do dia/)
})

test('comments: a progress card is labelled "Progresso" (and "Card de progresso" without a message), a photo stays "Foto"', () => {
  const withProgress = summary({ ...base, progress, caption: '' })
  assert.match(withProgress, />Progresso</)
  assert.match(withProgress, /Card de progresso/)
  assert.match(summary({ ...base, progress: null, caption: 'oi' }), />Foto</)
  assert.match(
    summary({ ...base, progress, caption: 'Semana concluída 💪' }),
    /Semana concluída 💪/
  )
})

test('legacy achievements keep rendering in comments, labelled "Conquista" (not "Conquista do dia")', () => {
  const html = summary({
    id: 's2',
    authorId: 'u1',
    type: 'achievement',
    achievement: { text: 'Voltei!' },
    createdAt: '2026-10-02T12:00:00Z',
  })
  assert.match(html, /Conquista/)
  assert.doesNotMatch(html, /Conquista do dia/)
})
