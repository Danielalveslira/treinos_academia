import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { copyTextToClipboard } from './clipboard.js'

// Node expõe um `navigator` global (getter, não gravável por atribuição direta) --
// Object.defineProperty troca o descriptor inteiro, e o restore devolve o original
// exatamente como estava antes de cada teste.
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
}
afterEach(() => {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
  } else {
    delete globalThis.navigator
  }
})

test('copyTextToClipboard writes the exact text via navigator.clipboard and reports success', async () => {
  const calls = []
  setNavigator({ clipboard: { writeText: async (text) => calls.push(text) } })
  const result = await copyTextToClipboard('chave-pix-teste@evolutus.app')
  assert.deepEqual(result, { copied: true })
  assert.deepEqual(calls, ['chave-pix-teste@evolutus.app'])
})

test('copyTextToClipboard never throws when the Clipboard API rejects -- reports failure instead', async () => {
  setNavigator({
    clipboard: {
      writeText: async () => {
        throw new Error('denied')
      },
    },
  })
  const result = await copyTextToClipboard('x')
  assert.deepEqual(result, { copied: false })
})

test('copyTextToClipboard reports failure when navigator.clipboard does not exist at all', async () => {
  setNavigator({})
  const result = await copyTextToClipboard('x')
  assert.deepEqual(result, { copied: false })
})
