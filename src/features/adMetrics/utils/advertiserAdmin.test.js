import test from 'node:test'
import assert from 'node:assert/strict'
import { advertiserDate, advertiserError, isAdvertiserAccessDenied } from './advertiserAdmin.js'
test('concession dates are pt-BR dates and missing/invalid dates remain unavailable', () => {
  assert.equal(advertiserDate(new Date(2026, 9, 24, 12).toISOString()), '24/10/2026')
  for (const value of [null, undefined, '', 'invalid'])
    assert.equal(advertiserDate(value), 'Data não informada')
})
test('access denial and immutable ownership have specific messages, without exposing raw errors', () => {
  for (const error of [
    { code: '42501' },
    { message: 'PERMISSION_DENIED' },
    { message: 'SESSION_REVOKED' },
  ]) {
    assert.equal(isAdvertiserAccessDenied(error), true)
    assert.match(advertiserError(error), /Acesso negado/)
  }
  assert.match(
    advertiserError({ message: 'CAMPAIGN_OWNER_IMMUTABLE' }),
    /titularidade não pode ser transferida/
  )
  assert.doesNotMatch(advertiserError({ message: 'secret SQL connection detail' }), /secret SQL/)
})
