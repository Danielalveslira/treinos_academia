import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateAuthError } from './authErrors.js'

test('translateAuthError maps known codes and falls back to a generic message', () => {
  assert.equal(translateAuthError({ code: 'invalid_credentials' }), 'E-mail ou senha incorretos.')
  assert.equal(translateAuthError({ code: 'unknown_code' }), 'Ocorreu um erro. Tente novamente.')
  assert.equal(translateAuthError(undefined), 'Ocorreu um erro. Tente novamente.')
})

// A conta é desativada no Auth assim que a exclusão é solicitada (queue_deletion,
// síncrono) -- uma tentativa de login logo em seguida precisa de uma mensagem clara e
// distinta de "senha incorreta", não um erro genérico.
test('translateAuthError gives a clear, specific message for a login attempt on a disabled/deleting account', () => {
  assert.equal(translateAuthError({ code: 'user_banned' }), 'Esta conta não está mais disponível.')
})

// Bug "conta com exclusão bloqueada": o e-mail continua reservado no Auth enquanto o job
// de exclusão não chega na etapa final (auth.admin.deleteUser), o que nunca acontece
// sozinho enquanto o job estiver blocked_financial_review (só um admin resolve). Um
// recadastro com o mesmo e-mail precisa de uma saída clara, não um "já cadastrado" sem
// próximo passo.
test('translateAuthError points a duplicate-email registration attempt toward support, in case it belongs to a pending deletion', () => {
  const message = translateAuthError({ code: 'user_already_exists' })
  assert.match(message, /já está cadastrado/)
  assert.match(message, /atendimento/)
})
