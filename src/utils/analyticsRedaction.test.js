import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactAnalyticsUrl, redactAnalyticsEvent } from './analyticsRedaction.js'

test('redactAnalyticsUrl remove token_hash e demais query params de /redefinir-senha, mantendo o pathname', () => {
  const result = redactAnalyticsUrl(
    'https://evolutus.com.br/redefinir-senha?token_hash=abc123&type=recovery'
  )
  assert.equal(result, 'https://evolutus.com.br/redefinir-senha')
})

test('redactAnalyticsUrl remove purchase_id/order_nsu/transaction_nsu do retorno de pagamento em /evocash', () => {
  const result = redactAnalyticsUrl(
    'https://evolutus.com.br/evocash?checkout_return=1&purchase_id=p1&order_nsu=n1&transaction_nsu=n2&slug=pacote'
  )
  assert.equal(result, 'https://evolutus.com.br/evocash')
})

test('redactAnalyticsUrl mantém intacta uma URL que já não tem query', () => {
  const result = redactAnalyticsUrl('https://evolutus.com.br/historico')
  assert.equal(result, 'https://evolutus.com.br/historico')
})

test('redactAnalyticsUrl devolve a URL original (sem lançar) quando o valor não é uma URL válida', () => {
  assert.equal(redactAnalyticsUrl('não-é-uma-url'), 'não-é-uma-url')
  assert.equal(redactAnalyticsUrl(''), '')
})

test('redactAnalyticsEvent preserva os demais campos do evento e só troca url', () => {
  const event = { type: 'pageview', url: 'https://evolutus.com.br/perfil?busca=joao' }
  const result = redactAnalyticsEvent(event)
  assert.deepEqual(result, { type: 'pageview', url: 'https://evolutus.com.br/perfil' })
})
