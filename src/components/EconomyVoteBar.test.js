import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// renderToStaticMarkup só (nunca act()/TestRenderer -- ver o aviso no topo de
// EconomyVotersDialog.test.js): aqui isso é suficiente, já que o modal só monta quando
// openVotersDialog deixa de ser null (nunca no render inicial), e a lógica de qual
// direção ele abre com (EconomyVotersDialogBody/initialVotersDialogState) já está
// coberta a fundo em EconomyVotersDialog.test.js.
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
              export const listPostEconomyVoters = async () => ({ voters: [], nextCursor: null })
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

test('a non-author sees both vote buttons and the clickable totals', () => {
  const html = render({ status: STATUS, currentUserId: 'voter1', myVote: null })
  assert.match(html, /Voto positivo/)
  assert.match(html, /Voto negativo/)
  assert.match(html, /2 apoios/)
  assert.match(html, /1 negativo/)
})

test('the author never sees the vote buttons (sem-auto-voto), but still sees the totals', () => {
  const html = render({ status: STATUS, currentUserId: 'author1', myVote: null })
  assert.doesNotMatch(html, /Voto positivo/)
  assert.doesNotMatch(html, /Voto negativo/)
  assert.match(html, /2 apoios/)
  assert.match(html, /1 negativo/)
})

test('singular/plural copy: exactly 1 uses the singular form, matching the requested UX copy', () => {
  const html = render({
    status: { ...STATUS, positiveVoteCount: 1, negativeVoteCount: 1 },
    currentUserId: 'author1',
    myVote: null,
  })
  assert.match(html, /1 apoio\b/)
  assert.doesNotMatch(html, /1 apoios/)
  assert.match(html, /1 negativo\b/)
  assert.doesNotMatch(html, /1 negativos/)
})

test('a post with no counters yet (pre-backfill, ver vote-count-service.js) shows 0, never crashes', () => {
  const html = render({
    status: { id: 'status2', authorId: 'author1' },
    currentUserId: 'author1',
    myVote: null,
  })
  assert.match(html, /0 apoios/)
  assert.match(html, /0 negativos/)
})

test('no voters dialog is present before any total is clicked', () => {
  const html = render({ status: STATUS, currentUserId: 'voter1', myVote: null })
  assert.doesNotMatch(html, /Quem votou/)
  assert.doesNotMatch(html, /Apoios \(/)
})
