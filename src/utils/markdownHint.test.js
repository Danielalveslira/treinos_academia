import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsMarkdown } from './markdownHint.js'

test('texto corrido simples não precisa de markdown', () => {
  for (const text of [
    'treino perna hoje?',
    'Bora treinar, pessoal! Quem vem?',
    'Hoje foi dia de peito e tríceps 💪',
    'Treino finalizado hoje!',
    'Às 18:30 na academia: quem vai?',
  ]) {
    assert.equal(needsMarkdown(text), false, text)
  }
})

test('qualquer sinal de sintaxe manda para o renderizador de markdown', () => {
  const samples = [
    '**negrito**',
    '_itálico_',
    '`código`',
    '~~riscado~~',
    '# título',
    '> citação',
    '[link](http://x.com)',
    'veja https://evolutus.app',
    'www.evolutus.app',
    'fale com a@b.com',
    'a | b',
    '1. primeiro',
    '- item',
    '+ item',
    'linha 1\nlinha 2',
    'linha 1\r\nlinha 2',
    '<b>oi</b>',
    'a &amp; b',
    '![img](x.png)',
    'a\\*b',
  ]
  for (const text of samples) assert.equal(needsMarkdown(text), true, text)
})

test('valores que não são texto não precisam de markdown', () => {
  assert.equal(needsMarkdown(null), false)
  assert.equal(needsMarkdown(undefined), false)
})

test('stripMarkdown deixa só o texto, sem a sintaxe', async () => {
  const { stripMarkdown } = await import('./markdownHint.js')
  assert.equal(
    stripMarkdown(
      '# Título\n\n- item **um**\n- item _dois_\n\n> citação\n\n[link](https://x.com) fim'
    ),
    'Título item um item dois citação link fim'
  )
  assert.equal(stripMarkdown('| A | B |\n| - | - |\n| 1 | 2 |'), 'A B - - 1 2')
  assert.equal(stripMarkdown('![foto](https://x.com/a.png) legenda'), 'foto legenda')
  assert.equal(stripMarkdown(null), '')
})
