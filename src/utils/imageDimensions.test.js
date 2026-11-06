import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readImageDimensions } from './imageDimensions.js'

function file(bytes) {
  return { slice: () => ({ arrayBuffer: async () => bytes.buffer }) }
}

test('sonda cabeçalhos PNG, GIF, JPEG e WebP antes da decodificação', async () => {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47])
  new DataView(png.buffer).setUint32(16, 600)
  new DataView(png.buffer).setUint32(20, 900)
  assert.deepEqual(await readImageDimensions(file(png)), { width: 600, height: 900 })
  const gif = new Uint8Array(10)
  gif.set([71, 73, 70])
  new DataView(gif.buffer).setUint16(6, 1200, true)
  new DataView(gif.buffer).setUint16(8, 800, true)
  assert.deepEqual(await readImageDimensions(file(gif)), { width: 1200, height: 800 })
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 100, 0, 200, 0xff, 0xd9])
  assert.deepEqual(await readImageDimensions(file(jpeg)), { width: 200, height: 100 })
  const webp = new Uint8Array(30)
  webp.set([82, 73, 70, 70])
  webp.set([87, 69, 66, 80], 8)
  webp.set([86, 80, 56, 88], 12)
  webp[24] = 99
  webp[27] = 49
  assert.deepEqual(await readImageDimensions(file(webp)), { width: 100, height: 50 })
  assert.equal(await readImageDimensions(file(new Uint8Array(30))), null)
})

test('JPEG de celular usa orientação EXIF para limitar o bitmap vertical', async () => {
  const jpeg = new Uint8Array(2 + 36 + 13 + 2)
  const view = new DataView(jpeg.buffer)
  jpeg.set([0xff, 0xd8, 0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0], 0)
  view.setUint32(16, 8, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 0x0112, true)
  view.setUint16(24, 3, true)
  view.setUint32(26, 1, true)
  view.setUint16(30, 6, true)
  jpeg.set([0xff, 0xc0, 0, 7, 8, 0x0b, 0xd0, 0x0f, 0xc0, 0xff, 0xd9], 38)
  assert.deepEqual(await readImageDimensions(file(jpeg)), { width: 3024, height: 4032 })
})
