import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

// IMPORTANTE: nunca use react-test-renderer (act()/TestRenderer.create) neste arquivo.
// Investigado a fundo: agrupar act()/TestRenderer com react-router-dom OU SegmentedControl
// na mesma árvore trava a saída do processo `node --test` neste projeto (reproduzido de
// forma isolada e mínima, independente de plugin do esbuild, de alias, ou de qual delas
// das duas causa -- renderToStaticMarkup sozinho nunca trava, com ou sem react-router-dom
// real). Por isso PostSupportersDialog.jsx extrai a transição de estado como um reducer
// puro (supportersDialogReducer/initialSupportersDialogState, sem I/O) -- testado aqui só como
// função, sem renderizar nada -- e SupporterRow é verificado via renderToStaticMarkup (nunca
// via clique simulado).
// CJS + outfile + createRequire (não ESM/data-uri): react-dom/server usa require()
// dinâmico de módulos nativos do Node (ex.: "stream") internamente, que só funciona
// com um require de verdade disponível -- o mesmo padrão já usado por RowActionsMenu.
// test.js/WorkoutExerciseGuide.test.js para renderToStaticMarkup.
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'post-supporters-dialog-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { SupporterRow, PostSupportersDialogBody, supportersDialogReducer, initialSupportersDialogState } from './PostSupportersDialog.jsx'
        export { supportersDialogReducer, initialSupportersDialogState }
        export const renderBody = (props) =>
          renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PostSupportersDialogBody, props)))
        export const renderRow = (supporter) =>
          renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SupporterRow, { supporter })))
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
        name: 'fixtures',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/services\/economyService$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }))
          pluginBuild.onResolve({ filter: /\/services\/profileAvatarService$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture-avatar',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              'export const listPostSupporters = async () => ({ supporters: [], nextCursor: null })',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-avatar' }, () => ({
            contents: 'export const loadAvatarBytes = async () => new Uint8Array()',
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
}

const { supportersDialogReducer, initialSupportersDialogState, renderRow, renderBody } =
  await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const alice = { userId: 'alice-uid', username: 'alice_v' }
const bob = { userId: 'bob-uid', username: 'bob_v' }
const cris = { userId: 'cris-uid', username: 'cris_v' }

test('the initial state has nothing loaded, no cursor and no error', () => {
  assert.deepEqual(initialSupportersDialogState(), {
    supporters: [],
    nextCursor: null,
    loaded: false,
    loading: false,
    error: '',
  })
})

test('load_start shows the loading state and clears a previous error', () => {
  const state = supportersDialogReducer(
    { ...initialSupportersDialogState(), error: 'x' },
    { type: 'load_start' }
  )
  assert.equal(state.loading, true)
  assert.equal(state.error, '')
})

test('first page replaces, "carregar mais" appends and keeps the cursor of the last page', () => {
  let state = supportersDialogReducer(initialSupportersDialogState(), {
    type: 'load_success',
    supporters: [alice, bob],
    nextCursor: { at: 't1', userId: 'bob-uid' },
    reset: true,
  })
  assert.deepEqual(
    state.supporters.map((item) => item.userId),
    ['alice-uid', 'bob-uid']
  )
  assert.deepEqual(state.nextCursor, { at: 't1', userId: 'bob-uid' })
  assert.equal(state.loaded, true)
  state = supportersDialogReducer(state, {
    type: 'load_success',
    supporters: [cris],
    nextCursor: null,
    reset: false,
  })
  assert.deepEqual(
    state.supporters.map((item) => item.userId),
    ['alice-uid', 'bob-uid', 'cris-uid']
  )
  assert.equal(state.nextCursor, null)
})

test('a page that repeats someone already listed never duplicates them', () => {
  let state = supportersDialogReducer(initialSupportersDialogState(), {
    type: 'load_success',
    supporters: [alice, bob],
    nextCursor: { at: 't', userId: 'bob-uid' },
    reset: true,
  })
  state = supportersDialogReducer(state, {
    type: 'load_success',
    supporters: [bob, cris],
    nextCursor: null,
    reset: false,
  })
  assert.deepEqual(
    state.supporters.map((item) => item.userId),
    ['alice-uid', 'bob-uid', 'cris-uid']
  )
})

test('an error keeps what is already listed and exposes the message for "tentar novamente"', () => {
  let state = supportersDialogReducer(initialSupportersDialogState(), {
    type: 'load_success',
    supporters: [alice],
    nextCursor: { at: 't', userId: 'alice-uid' },
    reset: true,
  })
  state = supportersDialogReducer(state, { type: 'load_start' })
  state = supportersDialogReducer(state, { type: 'load_error', message: 'falhou' })
  assert.equal(state.loading, false)
  assert.equal(state.error, 'falhou')
  assert.deepEqual(
    state.supporters.map((item) => item.userId),
    ['alice-uid']
  )
  assert.deepEqual(state.nextCursor, { at: 't', userId: 'alice-uid' })
})

test('an empty first page is "loaded" with no supporters (empty state, not a spinner)', () => {
  const state = supportersDialogReducer(initialSupportersDialogState(), {
    type: 'load_success',
    supporters: [],
    nextCursor: null,
    reset: true,
  })
  assert.equal(state.loaded, true)
  assert.equal(state.supporters.length, 0)
})

test('SupporterRow shows @username and links to that exact public profile', () => {
  const html = renderRow(alice)
  assert.match(html, /@alice_v/)
  assert.match(html, /href="\/comunidades\/perfil\/alice-uid"/)
})

test('SupporterRow falls back to "Membro" when there is no public username', () => {
  const html = renderRow({ userId: 'ghost-uid', username: null })
  assert.match(html, /Membro/)
  assert.match(html, /href="\/comunidades\/perfil\/ghost-uid"/)
})

test('SupporterRow never shows another supporter data (no cross-contamination)', () => {
  const html = renderRow(bob)
  assert.match(html, /@bob_v/)
  assert.doesNotMatch(html, /alice/)
})

test('there is no negative direction anywhere in the dialog state: only supporters exist', () => {
  const state = initialSupportersDialogState()
  assert.equal('negative' in state, false)
  assert.equal('direction' in state, false)
})

test('copy says "curtidas"/"Quem curtiu" and never "apoio"', () => {
  assert.match(renderBody({ statusId: 's1', supportCount: 3 }), /3 curtidas/)
  assert.match(renderBody({ statusId: 's1', supportCount: 1 }), /1 curtida\b/)
  const source = readFileSync(new URL('./PostSupportersDialog.jsx', import.meta.url), 'utf8')
  assert.match(source, /title="Quem curtiu"/)
  assert.match(source, /Ninguém curtiu ainda\./)
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, ''), /apoiou|apoios|apoio\b|Ninguém apoiou/)
})

// "Quem curtiu" é só texto: @usuario com link. Nada de avatar, placeholder ou espaço reservado para imagem.
test('SupporterRow renders ONLY the @username link: no image, no avatar, no placeholder', () => {
  const html = renderRow(alice)
  assert.doesNotMatch(html, /<img|<svg|profile-avatar|avatar/i)
  const links = html.match(/<a\b/g) || []
  assert.equal(links.length, 1)
  assert.equal(html.replace(/<[^>]*>/g, '').trim(), '@alice_v')
})

test('a supporter without username shows only "Membro" (still just text, still a profile link)', () => {
  const html = renderRow({ userId: 'ghost-uid', username: null })
  assert.equal(html.replace(/<[^>]*>/g, '').trim(), 'Membro')
  assert.match(html, /href="\/comunidades\/perfil\/ghost-uid"/)
  assert.doesNotMatch(html, /<img|<svg/)
})

test('the dialog source and the service no longer know avatars (data minimization: only userId and username)', () => {
  const dialog = readFileSync(new URL('./PostSupportersDialog.jsx', import.meta.url), 'utf8')
  const service = readFileSync(new URL('../services/economyService.js', import.meta.url), 'utf8')
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(strip(dialog), /ProfileAvatar|avatarPath|avatar_path/)
  assert.doesNotMatch(strip(service), /avatarPath|avatar_path/)
})
