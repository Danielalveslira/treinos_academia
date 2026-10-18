import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReminderEmail, formatBRL, formatDateBR } from './messages.js'

const BASE = {
  username: 'josea', packageLabel: 'Max', cashAmount: 300, amountCentavos: 4990,
  createdAt: '2026-10-15T12:56:00Z', appUrl: 'https://evolutus.app',
  supportEmail: 'suporte@evolutus.app', purchaseId: '1b0c541b-50b1-4847-971a-f8d74f179abf',
}

test('formatBRL formata centavos em reais no padrão pt-BR', () => {
  assert.equal(formatBRL(4990).replace(/\s/g, ' '), 'R$ 49,90')
  assert.equal(formatBRL(0).replace(/\s/g, ' '), 'R$ 0,00')
  assert.equal(formatBRL(null).replace(/\s/g, ' '), 'R$ 0,00')
})

test('formatDateBR formata uma data ISO e nunca quebra com entrada inválida', () => {
  assert.equal(formatDateBR('2026-10-15T12:56:00Z'), '15/10/2026')
  assert.equal(formatDateBR('not-a-date'), '')
  assert.equal(formatDateBR(undefined), '')
})

test('buildReminderEmail preenche o template (plano, EvoCash, valor, data, link, suporte, protocolo)', () => {
  const { subject, html, text } = buildReminderEmail(BASE)
  assert.match(subject, /300 EvoCash/)
  for (const body of [html, text]) {
    assert.match(body, /@josea/)
    assert.match(body, /Max/)
    assert.match(body, /\b300\b/)
    assert.ok(body.includes(formatBRL(4990)))
    assert.match(body, /15\/10\/2026/)
    assert.match(body, /https:\/\/evolutus\.app\/evocash/)
    assert.equal(body.includes('lembrete='), false, 'sem query param sem consumidor real')
    assert.match(body, /suporte@evolutus\.app/)
    assert.match(body, /1b0c541b-50b1-4847-971a-f8d74f179abf/)
  }
  assert.match(html, /<title>Sua compra de EvoCash está pendente<\/title>/)
  assert.match(html, /Concluir pagamento/)
})

test('nenhum placeholder do template fica sem substituir', () => {
  const { html } = buildReminderEmail(BASE)
  assert.equal(/__[A-Z_]+__/.test(html), false, 'nenhum __PLACEHOLDER__ deve sobrar no HTML enviado')
})

test('buildReminderEmail nunca injeta HTML a partir do username, do nome do pacote ou do e-mail de suporte', () => {
  const { html } = buildReminderEmail({
    ...BASE,
    username: '<img src=x onerror=alert(1)>',
    packageLabel: '</a><script>alert(2)</script>',
    supportEmail: '"><script>alert(3)</script>',
  })
  assert.equal(html.includes('<script>'), false)
  assert.equal(html.includes('<img src=x'), false)
  assert.match(html, /&lt;script&gt;/)
})

test('o e-mail é sempre transacional: nenhum rótulo promocional, e versão texto sempre acompanha o HTML', () => {
  const { html, text } = buildReminderEmail(BASE)
  for (const body of [html.toLowerCase(), text.toLowerCase()]) {
    for (const word of ['promoção', 'desconto', 'oferta', 'cupom']) {
      assert.equal(body.includes(word), false, `"${word}" não deveria aparecer num e-mail transacional`)
    }
  }
  assert.ok(text.length > 0)
})
