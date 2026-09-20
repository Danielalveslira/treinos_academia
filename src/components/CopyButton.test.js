import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Mesmo padrão de CashPackageCards.test.js: TestRenderer + act, mas o clique aqui
// dispara um handler ASSÍNCRONO (copyTextToClipboard) -- por isso `renderAndClick`
// aguarda a própria Promise devolvida por onClick() dentro do act(), garantindo que o
// setStatus(...) posterior ao await já tenha sido aplicado antes de inspecionar o
// resultado.
let directory
let renderAndClick
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'copy-button-tests-'))
  const outfile = join(directory, 'copy-button.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { CopyButton } from './CopyButton.jsx'

        export const renderAndClick = async (props) => {
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
          let component
          act(() => {
            component = TestRenderer.create(createElement(ThemeProvider, null,
              createElement(BaseStyles, null, createElement(CopyButton, props))))
          })
          // async act() trava neste ambiente sem DOM/scheduler real (sem
          // MessageChannel/timers que o act assíncrono do React espera pra flushar) --
          // aguardar a própria Promise devolvida por onClick() é suficiente, já que
          // setStatus roda de forma síncrona assim que o await interno de handleClick
          // resolve, antes da Promise de onClick() se resolver.
          await component.root.findByProps({ 'data-testid': props.testId }).props.onClick()
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
  ;({ renderAndClick } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

// Primer's <Text> renders nested elements, so `.children` on a react-test-renderer
// TestInstance isn't flat text -- flattens recursively down to the raw string leaves.
function textContent(instance) {
  return instance.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}

// Node expõe um `navigator` global (getter, não gravável por atribuição direta) --
// Object.defineProperty troca o descriptor inteiro; o restore devolve o original.
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
}
function restoreNavigator() {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
  } else {
    delete globalThis.navigator
  }
}

test('clicking the button copies the full value, never a shortened one, and shows the success feedback', async () => {
  const calls = []
  setNavigator({ clipboard: { writeText: async (text) => calls.push(text) } })
  const component = await renderAndClick({
    value: 'chave-pix-bem-longa-e-aleatoria-1234567890abcdef',
    label: 'Copiar chave',
    successMessage: 'Chave PIX copiada',
    testId: 'copy-pix-key',
  })
  assert.deepEqual(calls, ['chave-pix-bem-longa-e-aleatoria-1234567890abcdef'])
  const feedback = component.root.findByProps({ 'data-testid': 'copy-pix-key-feedback' })
  assert.equal(textContent(feedback), 'Chave PIX copiada')
  component.unmount()
  restoreNavigator()
})

test('when the Clipboard API fails, shows a visible failure message with the full value -- never silences it', async () => {
  setNavigator({
    clipboard: {
      writeText: async () => {
        throw new Error('denied')
      },
    },
  })
  const component = await renderAndClick({ value: 'valor-completo-de-fallback', testId: 'copy-x' })
  const feedback = component.root.findByProps({ 'data-testid': 'copy-x-feedback' })
  assert.match(textContent(feedback), /valor-completo-de-fallback/)
  component.unmount()
  restoreNavigator()
})
