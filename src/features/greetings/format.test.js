import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_NAME, formatGreetingText, sanitizeName } from './format.js'

test('sanitizeName remove controle/zero-width, colapsa espaços e preserva acentos', () => {
  assert.equal(sanitizeName('  Maria\n\tClara  '), 'Maria Clara')
  assert.equal(sanitizeName('Jo​ão'), 'João')
  assert.equal(sanitizeName('‮evil'), 'evil')
  assert.equal(sanitizeName('José'), 'José')
})

test('sanitizeName: ausente, vazio ou não-texto => vazio (o chamador usa o fallback)', () => {
  for (const value of [undefined, null, 42, {}, '', '   ', '\n\t'])
    assert.equal(sanitizeName(value), '')
})

test('sanitizeName trunca por grafema, com reticências, sem passar do limite', () => {
  const long = 'A'.repeat(50)
  const result = sanitizeName(long)
  assert.equal(Array.from(result).length, 20)
  assert.ok(result.endsWith('…'))
  assert.equal(sanitizeName('A'.repeat(20)), 'A'.repeat(20))
})

test('sanitizeName não parte emoji composto ao meio', () => {
  const family = '👨‍👩‍👧‍👦'
  const result = sanitizeName(family.repeat(25), 20)
  assert.ok(result.endsWith('…'))
  assert.equal(result.slice(0, -1), family.repeat(19))
})

test('formatGreetingText: usa {nome}, aceita templates sem nome e cai em "atleta"', () => {
  assert.equal(formatGreetingText('Oi, {nome}!', 'Ana'), 'Oi, Ana!')
  assert.equal(formatGreetingText('Treino feito.', 'Ana'), 'Treino feito.')
  assert.equal(formatGreetingText('Oi, {nome}!', ''), `Oi, ${DEFAULT_NAME}!`)
  assert.equal(formatGreetingText('Oi, {nome}!', undefined), `Oi, ${DEFAULT_NAME}!`)
  assert.equal(formatGreetingText('{nome} e {nome}', 'Bia'), 'Bia e Bia')
})

test('formatGreetingText: nome malicioso vira texto puro (sem substituição especial nem HTML interpretado)', () => {
  assert.equal(formatGreetingText('Oi, {nome}!', '$& $1 $`'), 'Oi, $& $1 $`!')
  const xss = formatGreetingText('Oi, {nome}!', '<img src=x onerror=alert(1)>')
  assert.ok(xss.startsWith('Oi, <img'), 'o texto fica literal; o React o escapa ao renderizar')
  assert.equal(xss.includes('\n'), false)
})
