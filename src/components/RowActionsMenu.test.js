import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let render
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'row-actions-menu-tests-'))
  const outfile = join(directory, 'menu.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { RowActionsMenu } from './RowActionsMenu.jsx'
        export const render = (props) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(RowActionsMenu, props))))
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
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

// renderToStaticMarkup só renderiza o botão-gatilho fechado — o ActionMenu.Overlay do
// Primer só monta os itens depois de um clique real, que esse tipo de teste não simula.
// Isso confirma a forma closed do novo formato `actions={[...]}`; não substitui a
// verificação manual de abrir o menu e clicar em cada ação (ver checklist do item 4).
test('trigger button renders the same way regardless of how many actions are configured', () => {
  const html = render({
    actions: [
      { key: 'edit', label: 'Editar', icon: () => null, onSelect: () => {} },
      { key: 'delete', label: 'Excluir', icon: () => null, variant: 'danger', onSelect: () => {} },
    ],
  })
  assert.match(html, /aria-haspopup="true"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /Mais ações/)
  assert.match(html, /octicon-kebab-horizontal/)
  // Limitação conhecida: os itens do menu não aparecem no HTML estático antes de abrir.
  assert.doesNotMatch(html, /Editar/)
  assert.doesNotMatch(html, /Excluir/)
})

test('renders the same trigger with a single action, for future non-edit/delete menus', () => {
  const html = render({
    actions: [{ key: 'leave', label: 'Sair', icon: () => null, variant: 'danger', onSelect: () => {} }],
  })
  assert.match(html, /aria-haspopup="true"/)
  assert.match(html, /Mais ações/)
})

test('disables the trigger while a row action is pending', () => {
  const html = render({
    disabled: true,
    actions: [{ key: 'delete', label: 'Excluir', icon: () => null, onSelect: () => {} }],
  })
  assert.match(html, /aria-haspopup="true"/)
  assert.match(html, /disabled=""/)
})
