import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleSheetKeyDown, viewportStyle } from './modalSheet.js'

// Contêiner falso: só o que a lógica de teclado usa.
function fakeContainer(count, activeIndex = -1) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: i,
    focus() {
      container.ownerDocument.activeElement = items[i]
    },
  }))
  const container = {
    items,
    ownerDocument: { activeElement: items[activeIndex] ?? null },
    querySelectorAll: () => items,
    contains: (el) => items.includes(el),
  }
  return container
}
const key = (name, shiftKey = false) => ({
  key: name,
  shiftKey,
  preventDefault() {
    this.prevented = true
  },
})

test('Escape closes the sheet (and is intercepted)', () => {
  let closed = 0
  const event = key('Escape')
  assert.equal(
    handleSheetKeyDown(event, fakeContainer(3), () => (closed += 1)),
    'close'
  )
  assert.equal(closed, 1)
  assert.equal(event.prevented, true)
})

test('Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last (focus stays inside)', () => {
  const last = fakeContainer(3, 2)
  const forward = key('Tab')
  assert.equal(
    handleSheetKeyDown(forward, last, () => {}),
    'wrap'
  )
  assert.equal(last.ownerDocument.activeElement, last.items[0])
  assert.equal(forward.prevented, true)
  const first = fakeContainer(3, 0)
  const backward = key('Tab', true)
  assert.equal(
    handleSheetKeyDown(backward, first, () => {}),
    'wrap-back'
  )
  assert.equal(first.ownerDocument.activeElement, first.items[2])
})

test('Tab inside the sheet in the middle of the list is left alone; Tab from outside the sheet is pulled back in', () => {
  const middle = fakeContainer(3, 1)
  assert.equal(
    handleSheetKeyDown(key('Tab'), middle, () => {}),
    null
  )
  const outside = fakeContainer(3, -1)
  assert.equal(
    handleSheetKeyDown(key('Tab'), outside, () => {}),
    'wrap'
  )
})

test('a sheet with nothing focusable traps Tab; other keys are ignored', () => {
  assert.equal(
    handleSheetKeyDown(key('Tab'), fakeContainer(0), () => {}),
    'trap'
  )
  assert.equal(
    handleSheetKeyDown(key('a'), fakeContainer(2, 0), () => {}),
    null
  )
})

test('keyboard open: the sheet follows the VISUAL viewport (height + offset), so the footer stays above the keyboard', () => {
  assert.deepEqual(viewportStyle({ height: 412.4, offsetTop: 0 }), {
    '--sheet-height': '412px',
    '--sheet-top': '0px',
  })
  assert.deepEqual(viewportStyle({ height: 500, offsetTop: 36.6 }), {
    '--sheet-height': '500px',
    '--sheet-top': '37px',
  })
})

test('without a usable VisualViewport the CSS fallback (100dvh) applies', () => {
  assert.equal(viewportStyle(undefined), null)
  assert.equal(viewportStyle(null), null)
  assert.equal(viewportStyle({ height: 0, offsetTop: 0 }), null)
  assert.equal(viewportStyle({ height: NaN }), null)
})
