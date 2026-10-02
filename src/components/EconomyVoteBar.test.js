import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// renderToStaticMarkup só (nunca act()/TestRenderer -- ver o aviso no topo de
// PostSupportersDialog.test.js): suficiente, já que o modal só monta quando supportersOpen
// vira true (nunca no render inicial), e a lógica da lista está coberta em
// PostSupportersDialog.test.js.
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'economy-vote-bar-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { EconomyVoteBar } from './EconomyVoteBar.jsx'
        export const render = (props) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null,
            createElement(MemoryRouter, null, createElement(EconomyVoteBar, props)))))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [
      {
        name: 'economy-service-fixture',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/services\/economyService$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `
              export const castVote = async () => ({ voted: true, action: 'create', charged: true, costCoins: 3 })
              export const listPostSupporters = async () => ({ supporters: [], nextCursor: null })
            `,
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
}

const { render } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const STATUS = { id: 'status1', authorId: 'author1', positiveVoteCount: 2, negativeVoteCount: 1 }

test('a non-author sees "Curtir · X" and the dislike as icon + count only', () => {
  const html = render({ status: STATUS, currentUserId: 'voter1', myVote: null })
  assert.match(html, />Curtir</)
  assert.match(html, /· 2/)
  assert.match(html, /aria-label="Não curtir \(1\)"/)
  assert.match(html, /data-testid="dislike-button"[^>]*>.*?1<\/span>/s)
})

test('no visible text "Não curtir"/"Não apoiar"/"Apoiar" anywhere: the dislike is icon + number, with an aria-label', () => {
  for (const currentUserId of ['voter1', 'author1']) {
    const html = render({ status: STATUS, currentUserId, myVote: null })
    const visible = html.replace(/<[^>]*>/g, '|')
    assert.doesNotMatch(visible, /Não curtir|Não apoiar|Apoiar|Negativ/)
  }
})

test('only the like count opens the people list: it is a button; the dislike never has a people affordance', () => {
  const html = render({ status: STATUS, currentUserId: 'voter1', myVote: null })
  assert.match(html, /aria-label="Ver quem curtiu \(2\)"/)
  assert.doesNotMatch(html, /quem n[ãa]o curtiu|quem n[ãa]o apoiou|Ver quem (?:descurtiu|negativ)/i)
  // Curtir, contador de curtidas e o botão de reação negativa -- nenhum botão extra para listar.
  assert.equal((html.match(/<button/g) || []).length, 3)
})

test('the author sees no reaction buttons, only "Curtidas · X" (opens the list) and a static dislike count', () => {
  const html = render({ status: STATUS, currentUserId: 'author1', myVote: null })
  assert.doesNotMatch(html, />Curtir</)
  assert.match(html, /Curtidas · 2/)
  assert.match(html, /role="img" aria-label="1 não curtiram"/)
  assert.doesNotMatch(html, /data-testid="dislike-button"/)
  assert.equal((html.match(/<button/g) || []).length, 1)
})

test('reflects the user own like: pressed state and "Você curtiu"; a dislike shows no text, only the pressed state', () => {
  const liked = render({ status: STATUS, currentUserId: 'voter1', myVote: { value: 1 } })
  assert.match(liked, /Você curtiu/)
  assert.match(
    liked,
    /aria-label="Curtir"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Curtir"/
  )
  const disliked = render({ status: STATUS, currentUserId: 'voter1', myVote: { value: -1 } })
  assert.doesNotMatch(disliked, /Você curtiu|Você apoiou|Você não/)
  assert.match(
    disliked,
    /aria-label="Não curtir \(1\)"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Não curtir \(1\)"/
  )
})

test('a post with no counters yet (pre-backfill) shows 0, never crashes', () => {
  const html = render({
    status: { id: 'status2', authorId: 'author1' },
    currentUserId: 'author1',
    myVote: null,
  })
  assert.match(html, /Curtidas · 0/)
  assert.match(html, /aria-label="0 não curtiram"/)
})

test('no likers dialog is present before the like count is clicked', () => {
  const html = render({ status: STATUS, currentUserId: 'voter1', myVote: null })
  assert.doesNotMatch(html, /Quem curtiu<\/h/)
})
