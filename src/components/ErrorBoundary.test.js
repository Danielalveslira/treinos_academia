import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let renderError
let actionFor
let retry
let reload

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'error-boundary-tests-'))
  const outfile = join(directory, 'error-boundary.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { ErrorBoundary } from './ErrorBoundary.jsx'

        function instanceFor(error) {
          const instance = new ErrorBoundary({ children: createElement('div', null, 'CONTEUDO') })
          instance.state = { error }
          return instance
        }

        export function renderError(error) {
          const output = instanceFor(error).render()
          return renderToStaticMarkup(createElement(ThemeProvider, null,
            createElement(BaseStyles, null, output)))
        }

        export function actionFor(error) {
          const output = instanceFor(error).render()
          const action = output.props.children[3].props.children
          return { label: action.props.children, variant: action.props.variant }
        }

        export function retry(error) {
          const instance = instanceFor(error)
          instance.setState = (patch) => {
            instance.state = { ...instance.state, ...patch }
          }
          instance.handleRetry()
          return {
            error: instance.state.error,
            html: renderToStaticMarkup(instance.render()),
          }
        }

        export function reload(error) {
          instanceFor(error).handleReload()
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
  ;({ renderError, actionFor, retry, reload } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  delete globalThis.window
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('generic error exposes only the operation retry as the primary action', () => {
  const html = renderError(new Error('falha transitória'))
  assert.match(html, /Algo deu errado/)
  assert.match(
    html,
    /Não foi possível carregar esta página\. Tente novamente em alguns instantes\./
  )
  assert.match(html, /Tentar novamente/)
  assert.doesNotMatch(html, /Recarregar/)
  assert.deepEqual(actionFor(new Error('falha transitória')), {
    label: 'Tentar novamente',
    variant: 'primary',
  })
})

test('retry clears the boundary error and renders its children again without a page reload', () => {
  let reloadCount = 0
  globalThis.window = { location: { reload: () => reloadCount++ } }
  const result = retry(new Error('falha transitória'))
  assert.equal(result.error, null)
  assert.match(result.html, /CONTEUDO/)
  assert.equal(reloadCount, 0)
})

test('a stale chunk keeps only the full-page reload required to fetch the current bundle', () => {
  const staleError = new Error('Failed to fetch dynamically imported module: /assets/Page.js')
  const html = renderError(staleError)
  assert.match(html, /Uma nova versão do app foi publicada/)
  assert.match(html, /Recarregar página/)
  assert.doesNotMatch(html, /Tentar novamente/)
  assert.deepEqual(actionFor(staleError), {
    label: 'Recarregar página',
    variant: 'primary',
  })

  let reloadCount = 0
  globalThis.window = { location: { reload: () => reloadCount++ } }
  reload(staleError)
  assert.equal(reloadCount, 1)
})
