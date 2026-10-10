import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// A tela da comunidade mostra no lugar do feed o que o SERVIDOR decidiu (get_community_access):
// membro não vê aviso (vê o feed), não-membro vê só o fluxo público de entrada, banido e
// indisponível veem bloqueio SEM botão de entrar. A decisão em si é coberta pelos testes SQL.
let directory
let render
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-access-notice-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { CommunityAccessNotice } from './CommunityAccessNotice.jsx'

        export const render = (props) => {
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({
            matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let component
          act(() => {
            component = TestRenderer.create(createElement(ThemeProvider, null,
              createElement(BaseStyles, null, createElement(CommunityAccessNotice, props))))
          })
          return component
        }
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
  })
  ;({ render } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

function textContent(instance) {
  return instance.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}
const pageText = (component) => textContent(component.root)
const joinButtons = (component) =>
  component.root.findAll(
    (node) => typeof node.props.onClick === 'function' && /Entrar/.test(textContent(node))
  )

test('member: nenhum aviso (a tela mostra o feed)', () => {
  const component = render({ access: 'member', onJoin() {} })
  assert.equal(pageText(component), '')
  assert.equal(joinButtons(component).length, 0)
})

test('not_member: só o fluxo público de entrada, com o botão Entrar', () => {
  let joined = 0
  const component = render({ access: 'not_member', onJoin: () => (joined += 1) })
  assert.match(pageText(component), /Entre para ver o feed/)
  const buttons = joinButtons(component)
  assert.ok(buttons.length > 0)
  buttons[0].props.onClick()
  assert.equal(joined, 1)
})

test('banned: bloqueio claro, sem botão Entrar e sem acionar a entrada', () => {
  const component = render({
    access: 'banned',
    onJoin() {
      throw new Error('não deveria entrar')
    },
  })
  assert.match(pageText(component), /Você não tem acesso a esta comunidade/)
  assert.match(pageText(component), /banido/)
  assert.doesNotMatch(pageText(component), /Entre para ver o feed/)
  assert.equal(joinButtons(component).length, 0)
})

test('unavailable: estado neutro, sem botão Entrar e sem vazar conteúdo', () => {
  const component = render({ access: 'unavailable', onJoin() {} })
  assert.match(pageText(component), /Comunidade indisponível/)
  assert.equal(joinButtons(component).length, 0)
})

test('estado desconhecido nega acesso como indisponível', () => {
  for (const access of [undefined, null, 'owner', 'MEMBER']) {
    const component = render({ access, onJoin() {} })
    assert.match(pageText(component), /Comunidade indisponível/)
    assert.equal(joinButtons(component).length, 0)
  }
})
