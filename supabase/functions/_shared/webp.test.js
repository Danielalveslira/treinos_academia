import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// webp.ts é TypeScript de Deno: o esbuild só remove os tipos pra rodar sob node --test.
const { outputFiles } = await build({
  entryPoints: [new URL('./webp.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
})
const { readWebpDimensions, isWebpComplete } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
)

function header(fourCC, fill) {
  const bytes = new Uint8Array(40)
  bytes.set(Buffer.from('RIFF'), 0)
  bytes.set(Buffer.from('WEBP'), 8)
  bytes.set(Buffer.from(fourCC), 12)
  fill(bytes, new DataView(bytes.buffer))
  return bytes
}

test('VP8X (canvas estendido): largura/altura em 24 bits menos 1', () => {
  const bytes = header('VP8X', (b) => {
    b[24] = 0xff // 1024 - 1 = 0x3ff
    b[25] = 0x03
    b[27] = 0xff
    b[28] = 0x01 // 512 - 1 = 0x1ff
  })
  assert.deepEqual(readWebpDimensions(bytes), { width: 1024, height: 512 })
})

test('VP8 (lossy): exige o código de sincronismo e mascara 14 bits', () => {
  const bytes = header('VP8 ', (b, view) => {
    b[23] = 0x9d
    b[24] = 0x01
    b[25] = 0x2a
    view.setUint16(26, 320, true)
    view.setUint16(28, 240, true)
  })
  assert.deepEqual(readWebpDimensions(bytes), { width: 320, height: 240 })
  bytes[23] = 0
  assert.equal(readWebpDimensions(bytes), null)
})

test('VP8L (lossless): largura/altura em 14 bits cada, mais 1', () => {
  const bytes = header('VP8L', (b, view) => {
    b[20] = 0x2f
    view.setUint32(21, (199 & 0x3fff) | ((99 & 0x3fff) << 14), true)
  })
  assert.deepEqual(readWebpDimensions(bytes), { width: 200, height: 100 })
})

test('falha fechado: não-WebP, curto demais ou chunk desconhecido', () => {
  assert.equal(readWebpDimensions(new Uint8Array(10)), null)
  assert.equal(readWebpDimensions(new Uint8Array(40)), null)
  assert.equal(readWebpDimensions(Buffer.from('<html>'.padEnd(40, ' '))), null)
  assert.equal(readWebpDimensions(header('ABCD', () => {})), null)
})

test('isWebpComplete: tamanho RIFF bate com o arquivo; truncado falha; bytes extras no fim são tolerados', () => {
  const bytes = header('VP8X', (b, view) => {
    view.setUint32(4, 40 - 8, true)
  })
  assert.equal(isWebpComplete(bytes), true)
  assert.equal(isWebpComplete(bytes.subarray(0, 30)), false, 'cortado no meio')
  const padded = new Uint8Array(50)
  padded.set(bytes)
  assert.equal(isWebpComplete(padded), true)
  assert.equal(isWebpComplete(new Uint8Array(8)), false)
  const zero = header('VP8X', () => {})
  assert.equal(isWebpComplete(zero), false, 'RIFF size 0')
})
