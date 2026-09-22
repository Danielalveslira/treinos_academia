import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyMarkdownAction,
  insertMarkdownLink,
  normalizeMarkdownLinkUrl,
} from './markdownToolbar.js'

test('bold/italic/code wrap the selection and select the inner text', () => {
  const result = applyMarkdownAction('bold', 'oi mundo', 3, 8)
  assert.equal(result.value, 'oi **mundo**')
  assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), 'mundo')
})

test('bold with empty selection inserts a placeholder and selects it', () => {
  const result = applyMarkdownAction('bold', 'oi ', 3, 3)
  assert.equal(result.value, 'oi **negrito**')
  assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), 'negrito')
})

test('link insertion preserves surrounding text and places the cursor after the link', () => {
  const result = insertMarkdownLink('veja isso agora', 5, 9, 'isso', 'https://example.com/')
  assert.equal(result.value, 'veja [isso](https://example.com/) agora')
  assert.equal(result.selectionStart, result.value.indexOf(' agora'))
  assert.equal(result.selectionEnd, result.selectionStart)
})

test('link URL normalization accepts web links and rejects unsafe protocols', () => {
  assert.equal(normalizeMarkdownLinkUrl('example.com/treino'), 'https://example.com/treino')
  assert.equal(normalizeMarkdownLinkUrl('http://example.com'), 'http://example.com/')
  for (const unsafe of [
    'javascript:alert(1)',
    'data:text/html,evil',
    'file:///tmp/a',
    '//evil.com',
    '',
  ]) {
    assert.equal(normalizeMarkdownLinkUrl(unsafe), null)
  }
})

test('quote/list prefix every line touched by the selection', () => {
  const value = 'linha um\nlinha dois\nlinha tres'
  const result = applyMarkdownAction('unorderedList', value, 0, value.length)
  assert.equal(result.value, '- linha um\n- linha dois\n- linha tres')
})

test('quote/list toggle off when the block is already prefixed', () => {
  const value = '- linha um\n- linha dois'
  const result = applyMarkdownAction('unorderedList', value, 0, value.length)
  assert.equal(result.value, 'linha um\nlinha dois')
})

test('prefix with no selection only affects the current line', () => {
  const value = 'primeira\nsegunda\nterceira'
  const cursor = value.indexOf('segunda') + 3
  const result = applyMarkdownAction('quote', value, cursor, cursor)
  assert.equal(result.value, 'primeira\n> segunda\nterceira')
})

test('italic and code preserve surrounding text and select the formatted text', () => {
  for (const [action, marker] of [
    ['italic', '_'],
    ['code', '`'],
  ]) {
    const result = applyMarkdownAction(action, 'oi mundo!', 3, 8)
    assert.equal(result.value, `oi ${marker}mundo${marker}!`)
    assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), 'mundo')
  }
})

test('line actions insert syntax into an empty editor or blank current line', () => {
  for (const [action, prefix] of [
    ['quote', '> '],
    ['unorderedList', '- '],
    ['orderedList', '1. '],
    ['checklist', '- [ ] '],
  ]) {
    assert.equal(applyMarkdownAction(action, '', 0, 0).value, prefix)
    assert.equal(applyMarkdownAction(action, '\ntexto', 0, 0).value, `${prefix}\ntexto`)
    assert.equal(applyMarkdownAction(action, 'texto\n', 6, 6).value, `texto\n${prefix}`)
  }
})

test('line actions leave the next line untouched when selection ends at its start', () => {
  const result = applyMarkdownAction('quote', 'primeira\nsegunda', 0, 9)
  assert.equal(result.value, '> primeira\nsegunda')
})

test('heading toggles on selected lines and block actions preserve surrounding content', () => {
  assert.equal(applyMarkdownAction('heading', 'Título', 0, 6).value, '## Título')
  assert.equal(applyMarkdownAction('heading', '## Título', 0, 9).value, 'Título')
  assert.equal(
    applyMarkdownAction('horizontalRule', 'antesdepois', 5, 5).value,
    'antes\n\n---\n\ndepois'
  )

  const table = applyMarkdownAction('table', '', 0, 0)
  assert.match(table.value, /^\| Coluna 1 \| Coluna 2 \|/)
  assert.equal(table.selectionStart, 2)
  assert.equal(table.selectionEnd, 2)
})
