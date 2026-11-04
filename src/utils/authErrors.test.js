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

test('translateAuthError does not reveal whether an account exists', () => {
  const message = translateAuthError({ code: 'user_already_exists' })
  assert.equal(message, translateAuthError({ code: 'email_exists' }))
  assert.doesNotMatch(message, /já está cadastrado|conta existente/)
  assert.match(message, /recuperar o acesso/)
})

// same_password (GoTrue): o novo cadastro tenta alinhar a senha da conta com a do
// formulário (syncSignupPassword) -- no caso normal, sem ataque, elas já são iguais, e o
// GoTrue rejeita com este código. O chamador trata isso como sucesso (ver authService.js),
// mas a mensagem continua mapeada para o caso raro de alguém bater nela diretamente (ex.:
// trocar a senha por uma igual à atual em "Minha conta").
test('translateAuthError: same_password tem mensagem própria', () => {
  assert.match(translateAuthError({ code: 'same_password' }), /diferente da atual/)
})

test('translateAuthError: email_not_confirmed orienta a confirmar o cadastro', () => {
  assert.match(translateAuthError({ code: 'email_not_confirmed' }), /[Cc]onfirme/)
})
