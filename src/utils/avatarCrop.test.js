import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drawAvatarCrop, encodeAvatarCrop, rotatedSize } from './avatarCrop.js'

test('geometria quadrada, horizontal e vertical preserva proporção e aplica rotação', () => {
  for (const [width, height, degrees] of [
    [400, 400, 0],
    [800, 400, 0],
    [400, 800, 90],
    [800, 400, 270],
  ]) {
    const calls = []
    const context = {
      clearRect: (...args) => calls.push(['clear', ...args]),
      translate: (...args) => calls.push(['translate', ...args]),
      rotate: (...args) => calls.push(['rotate', ...args]),
      drawImage: (...args) => calls.push(['draw', ...args]),
    }
    const canvas = { getContext: () => context }
    const rotated = rotatedSize(width, height, degrees)
    const side = Math.min(rotated.width, rotated.height)
    drawAvatarCrop(
      canvas,
      { width, height },
      { x: (rotated.width - side) / 2, y: (rotated.height - side) / 2, width: side, height: side },
      degrees
    )
    assert.equal(canvas.width, 320)
    assert.equal(canvas.height, 320)
    assert.equal(calls.at(-1)[0], 'draw')
    assert.equal(calls.at(-1)[4] / calls.at(-1)[5], width / height)
    assert.equal(calls.at(-2)[1], (degrees * Math.PI) / 180)
  }
})

test('enquadramento deslocado muda a translação sem criar canvas grande', () => {
  const moves = []
  const canvas = {
    getContext: () => ({
      clearRect() {},
      translate: (...args) => moves.push(args),
      rotate() {},
      drawImage() {},
    }),
  }
  const bitmap = { width: 900, height: 600 }
  drawAvatarCrop(canvas, bitmap, { x: 100, y: 0, width: 600, height: 600 }, 0)
  const first = moves[0][0]
  moves.length = 0
  drawAvatarCrop(canvas, bitmap, { x: 200, y: 0, width: 600, height: 600 }, 0)
  assert.ok(Math.abs(first - moves[0][0] - (100 * 320) / 600) < 1e-9)
  assert.equal(canvas.width, 320)
})

test('codificador reduz qualidade progressivamente e só retorna WebP dentro de 1 MB', async () => {
  const qualities = []
  const canvas = {
    toBlob(callback, type, quality) {
      qualities.push(quality)
      callback({ type, size: quality > 0.6 ? 2 * 1024 * 1024 : 500_000 })
    },
  }
  const blob = await encodeAvatarCrop(canvas)
  assert.equal(blob.size, 500_000)
  assert.deepEqual(qualities, [0.84, 0.72, 0.6])
})
