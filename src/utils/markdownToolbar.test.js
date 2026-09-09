import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMarkdownAction } from './markdownToolbar.js'

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

test('link wraps selection as label and selects the url placeholder', () => {
  const result = applyMarkdownAction('link', 'veja isso', 5, 9)
  assert.equal(result.value, 'veja [isso](url)')
  assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), 'url')
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
