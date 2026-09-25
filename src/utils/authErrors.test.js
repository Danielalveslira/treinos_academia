import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateAuthError, isAccountGoneError } from './authErrors.js'

test('translateAuthError maps known codes and falls back to a generic message', () => {
  assert.equal(translateAuthError({ code: 'auth/wrong-password' }), 'E-mail ou senha incorretos.')
  assert.equal(translateAuthError({ code: 'auth/unknown-code' }), 'Ocorreu um erro. Tente novamente.')
  assert.equal(translateAuthError(undefined), 'Ocorreu um erro. Tente novamente.')
})

// A conta é desativada no Auth assim que a exclusão é solicitada (queue(), síncrono) --
// uma tentativa de login logo em seguida precisa de uma mensagem clara e distinta de
// "senha incorreta", não um erro genérico.
test('translateAuthError gives a clear, specific message for a login attempt on a disabled/deleting account', () => {
  assert.equal(translateAuthError({ code: 'auth/user-disabled' }), 'Esta conta não está mais disponível.')
})

// Bug "conta com exclusão bloqueada": o e-mail continua reservado no Firebase Auth
// enquanto o job de exclusão não chega na etapa final (auth.deleteUser), o que nunca
// acontece sozinho enquanto o job estiver blocked_financial_review (só um admin resolve).
// Um recadastro com o mesmo e-mail precisa de uma saída clara, não um "já cadastrado"
// sem próximo passo.
test('translateAuthError points a duplicate-email registration attempt toward support, in case it belongs to a pending deletion', () => {
  const message = translateAuthError({ code: 'auth/email-already-in-use' })
  assert.match(message, /já está cadastrado/)
  assert.match(message, /atendimento/)
})

test('isAccountGoneError confirms only the codes that mean the account is truly disabled/deleted', () => {
  assert.equal(isAccountGoneError({ code: 'auth/user-disabled' }), true)
  assert.equal(isAccountGoneError({ code: 'auth/user-token-expired' }), true)
  assert.equal(isAccountGoneError({ code: 'auth/user-not-found' }), true)
  assert.equal(isAccountGoneError({ code: 'auth/invalid-user-token' }), true)
  // Falhas transitórias (rede, limite de tentativas) nunca devem derrubar a sessão —
  // são exatamente o tipo de erro que uma renovação de token pode disparar sem que a
  // conta tenha deixado de existir.
  assert.equal(isAccountGoneError({ code: 'auth/network-request-failed' }), false)
  assert.equal(isAccountGoneError({ code: 'auth/too-many-requests' }), false)
  assert.equal(isAccountGoneError(undefined), false)
  assert.equal(isAccountGoneError({}), false)
})
