import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInternalPath, originOf, originState, returnToOrigin } from './navigation.js'

function recorder() {
  const calls = []
  const navigate = (...args) => calls.push(args)
  return { calls, navigate }
}

test('originState registra caminho e query da tela atual', () => {
  assert.deepEqual(originState({ pathname: '/exercicios/7', search: '?a=1' }), {
    from: '/exercicios/7?a=1',
  })
  assert.deepEqual(originState({ pathname: '/' }), { from: '/' })
})

test('isInternalPath rejeita destinos externos ou protocol-relative', () => {
  assert.equal(isInternalPath('/comunidades'), true)
  assert.equal(isInternalPath('//evil.example'), false)
  assert.equal(isInternalPath('https://evil.example'), false)
  assert.equal(isInternalPath(undefined), false)
})

test('originOf ignora origem inválida ou igual à tela atual', () => {
  const here = { pathname: '/novo-treino', search: '' }
  assert.equal(originOf({ ...here, state: { from: '/' } }), '/')
  assert.equal(originOf({ ...here, state: { from: 'https://x.y' } }), null)
  assert.equal(originOf({ ...here, state: { from: '/novo-treino' } }), null)
  assert.equal(originOf({ ...here, state: null }), null)
})

test('cancelar com origem e histórico anterior volta uma entrada (sem duplicar histórico)', () => {
  const { calls, navigate } = recorder()
  const location = { pathname: '/novo-treino', search: '', state: { from: '/exercicios' } }
  returnToOrigin(navigate, location, '/', { idx: 3 })
  assert.deepEqual(calls, [[-1]])
})

test('cancelar com origem mas sem histórico anterior (PWA reaberto) vai para a origem com replace', () => {
  const { calls, navigate } = recorder()
  const location = { pathname: '/novo-treino', search: '', state: { from: '/exercicios' } }
  returnToOrigin(navigate, location, '/', { idx: 0 })
  assert.deepEqual(calls, [['/exercicios', { replace: true }]])
})

test('cancelar em deep link/refresh sem origem usa o fallback com replace, nunca navigate(-1)', () => {
  const { calls, navigate } = recorder()
  returnToOrigin(navigate, { pathname: '/novo-treino', search: '', state: null }, '/', { idx: 5 })
  assert.deepEqual(calls, [['/', { replace: true }]])
})

test('state.from externo é ignorado e cai no fallback', () => {
  const { calls, navigate } = recorder()
  const location = { pathname: '/novo-treino', search: '', state: { from: '//evil.example' } }
  returnToOrigin(navigate, location, '/', { idx: 2 })
  assert.deepEqual(calls, [['/', { replace: true }]])
})
