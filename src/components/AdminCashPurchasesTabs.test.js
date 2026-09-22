import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let renderAt

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'admin-cash-purchases-tabs-'))
  const outfile = join(directory, 'tabs.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { BaseStyles, ThemeProvider } from '@primer/react'
        import { MemoryRouter, useLocation } from 'react-router-dom'
        import { AdminCashPurchasesTabs } from './AdminCashPurchasesTabs.jsx'
        import { useAdminCashPurchasesTab } from '../hooks/useAdminCashPurchasesTab.js'

        function textContent(node) {
          if (typeof node === 'string') return node
          if (!node?.children) return ''
          return node.children.map(textContent).join('')
        }

        function Harness() {
          const { tab, selectTab } = useAdminCashPurchasesTab()
          const location = useLocation()
          return React.createElement(React.Fragment, null,
            React.createElement(AdminCashPurchasesTabs, { tab, onSelectTab: selectTab }),
            React.createElement('output', { 'data-panel': tab }, tab),
            React.createElement('output', { 'data-search': location.search }, location.search),
          )
        }

        function snapshot(renderer) {
          const buttons = renderer.root.findAllByType('button')
            .filter((button) => ['Pedidos', 'Configuração PIX'].includes(textContent(button)))
          const outputs = renderer.root.findAllByType('output')
          return {
            panel: outputs.find((output) => 'data-panel' in output.props).props['data-panel'],
            search: outputs.find((output) => 'data-search' in output.props).props['data-search'],
            current: buttons
              .filter((button) => button.props['aria-current'] === 'page')
              .map(textContent),
            inactiveHasAriaCurrent: buttons
              .filter((button) => button.props['aria-current'] !== 'page')
              .some((button) => button.props['aria-current'] !== undefined),
          }
        }

        export async function renderAtEntry(initialEntry) {
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({
            matches: false,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
          }))
          global.document = global.document || {
            addEventListener: () => {},
            removeEventListener: () => {},
          }
          let renderer
          act(() => {
            renderer = TestRenderer.create(
              React.createElement(MemoryRouter, { initialEntries: [initialEntry] },
                React.createElement(ThemeProvider, null,
                  React.createElement(BaseStyles, null, React.createElement(Harness)),
                ),
              ),
            )
          })
          return {
            read: () => snapshot(renderer),
            async select(label) {
              const button = renderer.root.findAllByType('button')
                .find((candidate) => textContent(candidate) === label)
              act(() => {
                button.props.onClick({ defaultPrevented: false })
              })
              return snapshot(renderer)
            },
            async unmount() {
              act(() => renderer.unmount())
            },
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
  })
  const require = createRequire(import.meta.url)
  ;({ renderAtEntry: renderAt } = require(outfile))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test('abre Pedidos por padrão com somente uma aba atual', async () => {
  const view = await renderAt('/admin/compras-evocash')
  assert.deepEqual(view.read(), {
    panel: 'pedidos',
    search: '',
    current: ['Pedidos'],
    inactiveHasAriaCurrent: false,
  })
  await view.unmount()
})

test('abre e mantém Configuração PIX ao carregar diretamente ?tab=pix', async () => {
  const view = await renderAt('/admin/compras-evocash?tab=pix')
  assert.deepEqual(view.read(), {
    panel: 'pix',
    search: '?tab=pix',
    current: ['Configuração PIX'],
    inactiveHasAriaCurrent: false,
  })
  await view.unmount()
})

test('alterna entre as abas sem exceção e mantém a URL sincronizada', async () => {
  const view = await renderAt('/admin/compras-evocash')
  assert.deepEqual(await view.select('Configuração PIX'), {
    panel: 'pix',
    search: '?tab=pix',
    current: ['Configuração PIX'],
    inactiveHasAriaCurrent: false,
  })
  assert.deepEqual(await view.select('Pedidos'), {
    panel: 'pedidos',
    search: '',
    current: ['Pedidos'],
    inactiveHasAriaCurrent: false,
  })
  await view.unmount()
})

test('query string inválida usa o fallback seguro para Pedidos', async () => {
  const view = await renderAt('/admin/compras-evocash?tab=desconhecida')
  const state = view.read()
  assert.equal(state.panel, 'pedidos')
  assert.deepEqual(state.current, ['Pedidos'])
  assert.equal(state.inactiveHasAriaCurrent, false)
  await view.unmount()
})
