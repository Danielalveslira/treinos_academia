import test from 'node:test'
import assert from 'node:assert/strict'
import { publicationErrorMessage } from './publicationError.js'
test('server quota refusal has clear feedback without leaking diagnostic details', () => {
  assert.match(publicationErrorMessage({ code:'PT429',details:'private diagnostic' }),/Limite de publicações/)
  assert.match(publicationErrorMessage({ message:'PUBLICATION_RATE_LIMITED' }),/Aguarde/)
  assert.equal(publicationErrorMessage(new Error('private diagnostic')),'Não foi possível publicar. Tente novamente.')
})
