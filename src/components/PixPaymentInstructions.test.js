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

const PROTOCOL = '1c900a83-7a5d-4fbd-8777-e47b0a9fe9c3'

const BASE_PROPS = {
  purchaseId: PROTOCOL,
  packageLabel: '120 EvoCash',
  cashAmount: 120,
  amountCentavos: 2390,
  qrCode: '00020126580014br.gov.bcb.pix...',
  qrCodeBase64: 'aGVsbG8=',
  ticketUrl: 'https://mercadopago.com/ticket/123',
}

test('renders package, amount, exact value, pix copy-paste code and an abbreviated protocol', () => {
  const html = renderStatic(BASE_PROPS)
  assert.match(html, /120 EvoCash/)
  assert.match(html, /R\$\s?23,90/)
  assert.match(html, /00020126580014br\.gov\.bcb\.pix/)
  // protocolo aparece abreviado como TEXTO visível (prefixo…sufixo) -- o valor completo só
  // existe no atributo title (tooltip) e no botão Copiar, nunca como texto na tela.
  assert.match(html, /1c900a83…a9fe9c3/)
  assert.doesNotMatch(html, new RegExp(`>${PROTOCOL}<`))
})

test('shows the copy-pix-code and copy-protocol affordances, and a link to the Mercado Pago ticket', () => {
  const html = renderStatic(BASE_PROPS)
  assert.match(html, /Copiar código PIX/)
  assert.match(html, />Copiar</)
  assert.match(html, /Abrir comprovante do Mercado Pago/)
})

test('shows the exact required waiting copy', () => {
  const html = renderStatic(BASE_PROPS)
  assert.match(
    html,
    /a confirmação é automática — o EvoCash é creditado assim que o Mercado Pago aprovar o pagamento/
  )
})

test('renders nothing when there is no qrCode (fail-safe, never invents payment instructions)', () => {
  const html = renderStatic({ ...BASE_PROPS, qrCode: null })
  assert.doesNotMatch(html, /Pagamento via PIX|Código PIX|Protocolo/)
})

test('renders without a QR code image or ticket link when they are absent', () => {
  const html = renderStatic({ ...BASE_PROPS, qrCodeBase64: null, ticketUrl: null })
  assert.doesNotMatch(html, /<img/)
  assert.doesNotMatch(html, /Abrir comprovante/)
})

test('a short protocol is shown in full (nothing to abbreviate)', () => {
  const html = renderStatic({ ...BASE_PROPS, purchaseId: 'abc123' })
  assert.match(html, />abc123</)
})
