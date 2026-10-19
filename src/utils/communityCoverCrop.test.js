import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverCropRect } from './imageCompression.js'

test('recorte 2:1 centralizado para imagens horizontais, verticais e quadradas', () => {
  for (const [width, height] of [
    [2400, 600],
    [600, 2400],
    [800, 800],
    [400, 200],
    [5000, 3000],
  ]) {
    const crop = coverCropRect(width, height)
    assert.equal(crop.width / crop.height, 2)
    assert.ok(crop.sx >= 0 && crop.sy >= 0)
    assert.ok(crop.sx + crop.width <= width)
    assert.ok(crop.sy + crop.height <= height)
    assert.equal(crop.sx, (width - crop.width) / 2)
    assert.equal(crop.sy, (height - crop.height) / 2)
  }
})

test('zoom e posição permanecem dentro da imagem original', () => {
  const crop = coverCropRect(600, 1200, 2, 1, 0)
  assert.equal(crop.width / crop.height, 2)
  assert.equal(crop.sx + crop.width, 600)
  assert.equal(crop.sy, 0)
})
