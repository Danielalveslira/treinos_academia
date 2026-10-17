import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACCOUNT_ACCESS_ERROR_MESSAGES, describeAccountAccessError } from './accountAccessErrors.js'

// Cada tela que chama uma RPC atrás de has_app_access()/private.has_account_standing() usa
// isto como fallback DEPOIS do seu próprio mapa de códigos de domínio -- ver
// src/components/PromoteDialog.jsx, src/pages/MyProfessionalListing.jsx,
// src/components/EconomyVoteBar.jsx, src/pages/Profile.jsx. Testa só o contrato (mensagem
// amigável para cada código conhecido, null para qualquer outro) -- não testa onde é usado.
test('describeAccountAccessError devolve uma mensagem amigável para cada código de bloqueio de conta', () => {
  for (const code of Object.keys(ACCOUNT_ACCESS_ERROR_MESSAGES)) {
    const message = describeAccountAccessError(code)
    assert.equal(typeof message, 'string')
    assert.ok(message.length > 0)
    // Nunca o código cru: não pode ser literalmente igual ao próprio código (ex.: 'ACCOUNT_DISABLED').
    assert.notEqual(message, code)
  }
})

test('describeAccountAccessError devolve null para qualquer código que não seja de bloqueio de conta (o chamador cai no próprio fallback)', () => {
  for (const code of ['TARGET_NOT_FOUND', 'INVALID_PACKAGE', undefined, null, '']) {
    assert.equal(describeAccountAccessError(code), null)
  }
})
