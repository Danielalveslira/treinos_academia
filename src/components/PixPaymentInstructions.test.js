import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let renderStatic
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pix-instructions-tests-'))
  const outfile = join(directory, 'pix-instructions.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { PixPaymentInstructions } from './PixPaymentInstructions.jsx'

        export const renderStatic = (props) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(PixPaymentInstructions, props))))
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
  ;({ renderStatic } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const PROTOCOL = '1c900a837a5d1fbd2777e47b0a9fe9c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8924640f'

const PIX_PAYMENT = {
  enabled: true,
  key: 'chave-pix-aleatoria-1234-5678-90ab-cdef1234567890',
  keyType: 'random',
  recipientName: 'Evolutus Ltda',
}

const BASE_PROPS = {
  purchaseId: PROTOCOL,
  packageLabel: '120 EvoCash',
  cashAmount: 120,
  amountCentavos: 2390,
  pixPayment: PIX_PAYMENT,
}

test('renders package, amount, exact value, pix key, key type label, recipient and an abbreviated protocol', () => {
  const html = renderStatic(BASE_PROPS)
  assert.match(html, /120 EvoCash/)
  assert.match(html, /R\$\s?23,90/)
  assert.match(html, /chave-pix-aleatoria-1234-5678-90ab-cdef1234567890/)
  assert.match(html, /Chave aleatória/)
  assert.match(html, /Evolutus Ltda/)
  // protocolo aparece abreviado como TEXTO visível (prefixo…sufixo) -- o valor completo só
  // existe no atributo title (tooltip) e no botão Copiar, nunca como texto na tela.
  assert.match(html, /1c900a83…924640f/)
  assert.doesNotMatch(html, new RegExp(`>${PROTOCOL}<`))
})

test('shows the copy-key and copy-protocol affordances', () => {
  const html = renderStatic(BASE_PROPS)
  assert.match(html, /Copiar chave/)
  assert.match(html, />Copiar</)
})

test('shows the exact required waiting copy', () => {
  const html = renderStatic(BASE_PROPS)
  assert.match(
    html,
    /Após realizar o PIX, aguarde a confirmação do pagamento\. O EvoCash será creditado somente após a aprovação\./
  )
  assert.match(html, /Envie exatamente o valor indicado no pedido\./)
})

test('renders nothing when pixPayment is not available (fail-safe, never invents payment instructions)', () => {
  const html = renderStatic({ ...BASE_PROPS, pixPayment: null })
  assert.doesNotMatch(html, /Pagamento via PIX|Chave PIX|Protocolo/)
})

test('maps every valid keyType to its Portuguese label', () => {
  const cases = [
    ['email', 'E-mail'],
    ['phone', 'Telefone'],
    ['cpf', 'CPF'],
    ['cnpj', 'CNPJ'],
    ['random', 'Chave aleatória'],
  ]
  for (const [keyType, label] of cases) {
    const html = renderStatic({ ...BASE_PROPS, pixPayment: { ...PIX_PAYMENT, keyType } })
    assert.match(html, new RegExp(label), `keyType=${keyType} deveria mostrar "${label}"`)
  }
})

test('a short protocol is shown in full (nothing to abbreviate)', () => {
  const html = renderStatic({ ...BASE_PROPS, purchaseId: 'abc123' })
  assert.match(html, />abc123</)
})
