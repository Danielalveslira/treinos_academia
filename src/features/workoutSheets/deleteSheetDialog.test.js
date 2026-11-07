import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

let dir, ui
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'delete-sheet-dialog-ui-'))
  const file = join(dir, 'ui.cjs')
  await build({
    stdin: {
      contents: `
    import React from 'react';import TestRenderer,{act} from 'react-test-renderer';
    import {DeleteSheetDialog} from './src/features/workoutSheets/DeleteSheetDialog.jsx';
    export {act};
    export function mount(props){let tree;act(()=>{tree=TestRenderer.create(React.createElement(DeleteSheetDialog,props))});return tree}
  `,
      resolveDir: resolve('.'),
      loader: 'jsx',
    },
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'ui-boundaries',
        setup(b) {
          b.onResolve({ filter: /^(react(?:\/.*)?|react-test-renderer)$/ }, ({ path }) => ({
            path: createRequire(import.meta.url).resolve(path),
            external: true,
          }))
          b.onResolve({ filter: /^@primer\/react$/ }, () => ({
            path: 'primer',
            namespace: 'fixture',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            resolveDir: resolve('.'),
            loader: 'jsx',
            contents: `
      import React from 'react';
      const element=(tag)=>React.forwardRef(({children,as,...props},ref)=>React.createElement(as||tag,{...props,ref},children));
      export const Box=element('div'),Text=element('p');
      export function Dialog({title,onClose,footerButtons,children}){
        return React.createElement('div',{role:'dialog','aria-label':title},
          React.createElement('h1',null,title),
          children,
          footerButtons.map((btn,i)=>React.createElement('button',{
            key:i,
            'data-testid':btn.content,
            disabled:btn.disabled,
            onClick:btn.onClick,
          },btn.content)),
        )
      }
    `,
          }))
        },
      },
    ],
  })
  ui = createRequire(import.meta.url)(file)
})
after(async () => {
  await rm(dir, { recursive: true, force: true })
})

const sheet = { id: 'sheet-1', name: 'Treino A', revision: 3 }
const button = (tree, label) =>
  tree.root.findAll((node) => node.type === 'button' && node.props['data-testid'] === label)[0]

test('shows the sheet name and both actions', () => {
  const tree = ui.mount({ sheet, onClose: () => {}, onConfirm: async () => '' })
  const html = JSON.stringify(tree.toJSON())
  assert.match(html, /Excluir ficha definitivamente/)
  assert.match(html, /Treino A/)
  assert.ok(button(tree, 'Cancelar'))
  assert.ok(button(tree, 'Excluir definitivamente'))
})

test('cancel closes without confirming', () => {
  let closed = false,
    confirmed = false
  const tree = ui.mount({
    sheet,
    onClose: () => {
      closed = true
    },
    onConfirm: async () => {
      confirmed = true
      return ''
    },
  })
  ui.act(() => button(tree, 'Cancelar').props.onClick())
  assert.equal(closed, true)
  assert.equal(confirmed, false)
})

test('confirm calls onConfirm once, disables the button while busy, then nothing blocks a second real render', async () => {
  let calls = 0
  let resolveConfirm
  const pending = new Promise((resolve) => {
    resolveConfirm = resolve
  })
  const tree = ui.mount({
    sheet,
    onClose: () => {},
    onConfirm: async () => {
      calls += 1
      await pending
      return ''
    },
  })
  // Dois cliques "rápidos" antes da promise resolver: o segundo clique acontece com o
  // botão já desabilitado (mesmo nó, estado busy), então o handler real nunca dispara de novo.
  let confirmPromise
  await ui.act(async () => {
    confirmPromise = button(tree, 'Excluir definitivamente').props.onClick()
  })
  const busyButton = button(tree, 'Excluindo…')
  assert.equal(busyButton.props.disabled, true)
  assert.equal(calls, 1)
  resolveConfirm()
  await ui.act(async () => {
    await confirmPromise
  })
  assert.equal(calls, 1)
})

test('a rejected/error confirm keeps the dialog open and shows the mapped message', async () => {
  const tree = ui.mount({
    sheet,
    onClose: () => {},
    onConfirm: async () => 'Esta ficha foi alterada em outra aba.',
  })
  await ui.act(async () => {
    await button(tree, 'Excluir definitivamente').props.onClick()
  })
  const html = JSON.stringify(tree.toJSON())
  assert.match(html, /Esta ficha foi alterada em outra aba\./)
  assert.ok(button(tree, 'Excluir definitivamente'))
})
