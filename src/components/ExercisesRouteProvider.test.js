import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let render

// A biblioteca inteira de exercícios não deve ser buscada em telas que só leem fichas
// (resumo bastando): lista/detalhe/execução de ficha e, agora, o seletor rápido /treinar.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'exercises-route-provider-tests-'))
  const outfile = join(directory, 'provider.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ExercisesRouteProvider } from './ExercisesRouteProvider.jsx'
        import { getLastEnabled, resetLastEnabled } from '../contexts/ExercisesContext'
        export function render(path, state) {
          resetLastEnabled()
          renderToStaticMarkup(
            createElement(
              MemoryRouter,
              { initialEntries: [{ pathname: path.split('?')[0], search: path.split('?')[1] ? '?' + path.split('?')[1] : '', state }] },
              createElement(ExercisesRouteProvider, null, createElement('span', null, 'ok'))
            )
          )
          return getLastEnabled()
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
    plugins: [
      {
        name: 'exercises-context-stub',
        setup(context) {
          context.onResolve({ filter: /contexts\/ExercisesContext$/ }, () => ({
            path: 'exercises-context',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^exercises-context$/, namespace: 'stub' }, () => ({
            loader: 'jsx',
            contents: `
              let lastEnabled = null
              export const ExercisesProvider = ({ children, enabled }) => {
                lastEnabled = enabled
                return children
              }
              export const getLastEnabled = () => lastEnabled
              export const resetLastEnabled = () => { lastEnabled = null }
            `,
          }))
        },
      },
    ],
  })
  ;({ render } = require(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('loads the exercise library on routes that consume it directly', () => {
  for (const path of ['/app', '/exercicios?aba=biblioteca', '/fichas/nova']) {
    assert.equal(render(path), true, path)
  }
  assert.equal(render('/exercicios?aba=catalogo', { openCatalog: true }), true)
})

test('skips the full library on sheet-only screens, including the /treinar quick picker', () => {
  for (const path of ['/novo-treino', '/exercicios', '/fichas/abc123', '/novo-treino?ficha=abc123', '/treinar']) {
    assert.equal(render(path), false, path)
  }
})
