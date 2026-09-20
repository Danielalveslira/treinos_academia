import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// IMPORTANTE: nunca use react-test-renderer (act()/TestRenderer.create) neste arquivo.
// Investigado a fundo: agrupar act()/TestRenderer com react-router-dom OU SegmentedControl
// na mesma árvore trava a saída do processo `node --test` neste projeto (reproduzido de
// forma isolada e mínima, independente de plugin do esbuild, de alias, ou de qual delas
// das duas causa -- renderToStaticMarkup sozinho nunca trava, com ou sem react-router-dom
// real). Por isso EconomyVotersDialog.jsx extrai a transição de estado como um reducer
// puro (votersDialogReducer/initialVotersDialogState, sem I/O) -- testado aqui só como
// função, sem renderizar nada -- e VoterRow é verificado via renderToStaticMarkup (nunca
// via clique simulado).
// CJS + outfile + createRequire (não ESM/data-uri): react-dom/server usa require()
// dinâmico de módulos nativos do Node (ex.: "stream") internamente, que só funciona
// com um require de verdade disponível -- o mesmo padrão já usado por RowActionsMenu.
// test.js/WorkoutExerciseGuide.test.js para renderToStaticMarkup.
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'economy-voters-dialog-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { VoterRow, votersDialogReducer, initialVotersDialogState } from './EconomyVotersDialog.jsx'
        export { votersDialogReducer, initialVotersDialogState }
        // renderToStaticMarkup nunca trava neste projeto (diferente de act()/
        // TestRenderer, ver comentário no topo do arquivo) -- seguro usar react-router-dom
        // real aqui só para resolver o href do Link.
        export const renderVoterRow = (voter) =>
          renderToStaticMarkup(createElement(MemoryRouter, null, createElement(VoterRow, { voter })))
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
            contents: 'export const listPostEconomyVoters = async () => ({ voters: [], nextCursor: null })',
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
}

const { votersDialogReducer, initialVotersDialogState, renderVoterRow } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('initialVotersDialogState starts on the requested direction, nothing loaded yet', () => {
  const state = initialVotersDialogState('positive')
  assert.equal(state.direction, 'positive')
  assert.deepEqual(state.votersByDirection, { positive: [], negative: [] })
  assert.deepEqual(state.loadedByDirection, { positive: false, negative: false })
  assert.equal(state.loading, false)
})

test('switch changes the active direction without touching any loaded data (clicar troca a lista exibida)', () => {
  let state = initialVotersDialogState('positive')
  state = votersDialogReducer(state, {
    type: 'load_success',
    direction: 'positive',
    voters: [{ userId: 'alice', username: 'alice_v' }],
    nextCursor: null,
    reset: true,
  })
  state = votersDialogReducer(state, { type: 'switch', direction: 'negative' })
  assert.equal(state.direction, 'negative')
  // trocar de aba nunca apaga o que já tinha carregado na outra.
  assert.deepEqual(state.votersByDirection.positive, [{ userId: 'alice', username: 'alice_v' }])
})

test('load_success with reset:true replaces the list for that direction, never mixing with the other direction', () => {
  let state = initialVotersDialogState('positive')
  state = votersDialogReducer(state, {
    type: 'load_success',
    direction: 'positive',
    voters: [{ userId: 'alice', username: 'a' }],
    nextCursor: null,
    reset: true,
  })
  state = votersDialogReducer(state, {
    type: 'load_success',
    direction: 'negative',
    voters: [{ userId: 'bob', username: 'b' }],
    nextCursor: null,
    reset: true,
  })
  assert.deepEqual(state.votersByDirection.positive.map((v) => v.userId), ['alice'])
  assert.deepEqual(state.votersByDirection.negative.map((v) => v.userId), ['bob'])
  assert.equal(state.loadedByDirection.positive, true)
  assert.equal(state.loadedByDirection.negative, true)
})

test('pagination: load_success with reset:false appends to the existing list instead of replacing it', () => {
  let state = initialVotersDialogState('positive')
  state = votersDialogReducer(state, {
    type: 'load_success',
    direction: 'positive',
    voters: [{ userId: 'alice', username: 'a' }],
    nextCursor: { firstChargedAtMs: 1, voterId: 'alice' },
    reset: true,
  })
  state = votersDialogReducer(state, {
    type: 'load_success',
    direction: 'positive',
    voters: [{ userId: 'carol', username: 'c' }],
    nextCursor: null,
    reset: false,
  })
  assert.deepEqual(state.votersByDirection.positive.map((v) => v.userId), ['alice', 'carol'])
  assert.equal(state.cursorByDirection.positive, null)
})

test('load_start/load_error toggle loading and surface the error message, only for the direction being loaded', () => {
  let state = initialVotersDialogState('positive')
  state = votersDialogReducer(state, { type: 'load_start' })
  assert.equal(state.loading, true)
  assert.equal(state.error, '')
  state = votersDialogReducer(state, { type: 'load_error', message: 'falhou' })
  assert.equal(state.loading, false)
  assert.equal(state.error, 'falhou')
})

test('a fresh load_start clears a previous error', () => {
  let state = initialVotersDialogState('positive')
  state = votersDialogReducer(state, { type: 'load_error', message: 'falhou' })
  state = votersDialogReducer(state, { type: 'load_start' })
  assert.equal(state.error, '')
})

test('unknown actions are a no-op (defensive default), never throw or corrupt state', () => {
  const state = initialVotersDialogState('positive')
  const next = votersDialogReducer(state, { type: 'bogus' })
  assert.deepEqual(next, state)
})

// "perfil correto é exibido": VoterRow mostra exatamente @username + link para o
// perfil público daquele userId -- nunca de outro voter, nunca campo interno nenhum.
test('VoterRow shows the correct username and links to that exact userId public profile', () => {
  const html = renderVoterRow({ userId: 'alice-uid', username: 'alice_v' })
  assert.match(html, /@alice_v/)
  assert.match(html, /href="\/comunidades\/perfil\/alice-uid"/)
})

test('VoterRow falls back to "Membro" when the voter has no username, matching the rest of the app', () => {
  const html = renderVoterRow({ userId: 'ghost-uid', username: null })
  assert.match(html, />Membro</)
  assert.match(html, /href="\/comunidades\/perfil\/ghost-uid"/)
})

test('VoterRow for a different voter never shows another voter data (no cross-contamination)', () => {
  const html = renderVoterRow({ userId: 'bob-uid', username: 'bob_v' })
  assert.doesNotMatch(html, /alice/)
  assert.match(html, /@bob_v/)
})
