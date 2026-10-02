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
          pluginBuild.onResolve({ filter: /\/services\/profileAvatarService$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture-avatar',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-avatar' }, () => ({
            contents: 'export const loadAvatarBytes = async () => new Uint8Array()',
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

test('a non-author sees Apoiar · X and Não apoiar · Y', () => {
  const html = render({ status: STATUS, currentUserId: 'voter1', myVote: null })
  assert.match(html, />Apoiar</)
  assert.match(html, />Não apoiar</)
  assert.match(html, /· 2/)
  assert.match(html, /· 1/)
})

test('only the support count opens the people list: it is a button; the non-support count is plain text', () => {
  const html = render({ status: STATUS, currentUserId: 'voter1', myVote: null })
  assert.match(html, /aria-label="Ver quem apoiou \(2\)"/)
  // Não apoiar tem UM botão (a ação de reagir) e o contador ao lado é texto, sem botão/link.
  assert.match(html, /data-testid="non-support-count"/)
  assert.doesNotMatch(html, /<button[^>]*data-testid="non-support-count"/)
  assert.doesNotMatch(html, /<a[^>]*non-support/)
  assert.doesNotMatch(html, /quem não apoiou|ver quem n[ãa]o apoiou|Negativos \(/i)
  assert.equal((html.match(/<button/g) || []).length, 3) // Apoiar, contador de apoios, Não apoiar
})

test('the author never sees the reaction buttons (sem-auto-voto), but still sees both totals and can open supporters', () => {
  const html = render({ status: STATUS, currentUserId: 'author1', myVote: null })
  assert.doesNotMatch(html, />Apoiar</)
  assert.doesNotMatch(html, />Não apoiar</)
  assert.match(html, /Apoios · 2/)
  assert.match(html, /Não apoiar · 1/)
  assert.equal((html.match(/<button/g) || []).length, 1) // só "Apoios · X"
})

test('reflects the user own reaction: pressed state and status text', () => {
  const supported = render({ status: STATUS, currentUserId: 'voter1', myVote: { value: 1 } })
  assert.match(supported, /Você apoiou/)
  assert.match(supported, /aria-pressed="true"[^>]*>(?:(?!<button).)*Apoiar/s)
  const notSupported = render({ status: STATUS, currentUserId: 'voter1', myVote: { value: -1 } })
  assert.match(notSupported, /Você não apoiou/)
})

test('a post with no counters yet (pre-backfill) shows 0, never crashes', () => {
  const html = render({
    status: { id: 'status2', authorId: 'author1' },
    currentUserId: 'author1',
    myVote: null,
  })
  assert.match(html, /Apoios · 0/)
  assert.match(html, /Não apoiar · 0/)
})

test('no supporters dialog is present before the support count is clicked', () => {
  const html = render({ status: STATUS, currentUserId: 'voter1', myVote: null })
  assert.doesNotMatch(html, /Quem apoiou<\/h/)
})
