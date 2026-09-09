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
