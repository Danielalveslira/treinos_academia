import test from 'node:test'
import assert from 'node:assert/strict'
import {
  commercialDocumentLink,
  commercialTermsError,
  commercialTermsState,
} from './commercialTerms.js'
import { commercialError } from './commercial.js'
import { purchaseError } from './quantityPurchase.js'

const ready = { documentId: 'evocash-terms', version: '1.0.0', digest: 'd', conditionsDigest: 'c', current: true }

test('contratação só fica disponível com termos publicados e vigentes', () => {
  assert.equal(commercialTermsState(null), 'unavailable')
  assert.equal(commercialTermsState({ ...ready, version: null, digest: null }), 'unavailable')
  assert.equal(commercialTermsState({ ...ready, conditionsDigest: '' }), 'unavailable')
  assert.equal(commercialTermsState({ ...ready, current: false }), 'changed')
  assert.equal(commercialTermsState(ready), 'ready')
})

test('links estáveis para a versão exata', () => {
  assert.equal(commercialDocumentLink('evocash-terms', '1.0.0'), '/condicoes-evocash?version=1.0.0')
  assert.equal(commercialDocumentLink('advertising-terms'), '/termos-publicidade')
  assert.equal(commercialDocumentLink('unknown', '1.0.0'), null)
})

test('erros de termos são explicados sem prometer cobrança', () => {
  for (const code of ['COMMERCIAL_TERMS_CHANGED', 'COMMERCIAL_TERMS_UNAVAILABLE', 'COMMERCIAL_CONDITIONS_MISMATCH']) {
    assert.match(commercialTermsError(new Error(code)), /Nada foi cobrado|Nenhum valor foi cobrado/)
    assert.equal(commercialError(new Error(code)), commercialTermsError(new Error(code)))
    assert.equal(purchaseError(new Error(code)), commercialTermsError(new Error(code)))
  }
  assert.match(purchaseError(new Error('MINOR_PURCHASE_BLOCKED')), /menores de 18 anos/)
  assert.equal(commercialTermsError(new Error('OTHER')), null)
})
