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
const { readWebpDimensions, isWebpComplete, findForbiddenWebpChunk } = await import(
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

// Monta um WebP com a lista de chunks pedida (fourCC + tamanho do payload), RIFF consistente.
function webpWith(chunks, { pad = true } = {}) {
  const parts = [Buffer.from('WEBP')]
  for (const [fourCC, size] of chunks) {
    const header = Buffer.alloc(8)
    header.write(fourCC, 0, 'latin1')
    header.writeUInt32LE(size, 4)
    parts.push(header, Buffer.alloc(size + (pad ? size % 2 : 0)))
  }
  const body = Buffer.concat(parts)
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 'latin1')
  riff.writeUInt32LE(body.length, 4)
  return new Uint8Array(Buffer.concat([riff, body]))
}

test('metadata: WebP lossy simples, lossless e com alfa/ICC passam (nada válido quebra)', () => {
  assert.equal(findForbiddenWebpChunk(webpWith([['VP8 ', 30]])), null, 'lossy simples (canvas do Chrome)')
  assert.equal(findForbiddenWebpChunk(webpWith([['VP8L', 25]])), null, 'lossless, tamanho ímpar com preenchimento')
  assert.equal(
    findForbiddenWebpChunk(webpWith([['VP8X', 10], ['ICCP', 17], ['ALPH', 9], ['VP8 ', 31]])),
    null,
    'VP8X + perfil de cor + alfa + imagem'
  )
  assert.equal(findForbiddenWebpChunk(webpWith([['VP8 ', 31]], { pad: false })), null, 'último chunk ímpar sem preenchimento é tolerado')
  const trailing = new Uint8Array([...webpWith([['VP8 ', 30]]), 1, 2, 3, 4, 5])
  assert.equal(findForbiddenWebpChunk(trailing), null, 'bytes depois do fim do RIFF são ignorados')
})

test('metadata: EXIF e XMP são recusados em qualquer posição da lista de chunks', () => {
  assert.equal(findForbiddenWebpChunk(webpWith([['VP8X', 10], ['VP8 ', 30], ['EXIF', 21]])), 'EXIF', 'EXIF no fim')
  assert.equal(findForbiddenWebpChunk(webpWith([['VP8X', 10], ['XMP ', 40], ['VP8 ', 30]])), 'XMP', 'XMP no meio')
  assert.equal(findForbiddenWebpChunk(webpWith([['EXIF', 4], ['XMP ', 4]])), 'EXIF')
})

test('metadata: tamanho de chunk que estoura o arquivo é MALFORMED; arquivo curto também', () => {
  const bad = webpWith([['VP8X', 10], ['VP8 ', 30]])
  new DataView(bad.buffer).setUint32(16, 5000, true)
  assert.equal(findForbiddenWebpChunk(bad), 'MALFORMED')
  assert.equal(findForbiddenWebpChunk(new Uint8Array(10)), 'MALFORMED')
  assert.equal(findForbiddenWebpChunk(webpWith([['VP8 ', 30]]).subarray(0, 26)), 'MALFORMED', 'cortado no meio do chunk')
  const dangling = webpWith([['VP8 ', 30]])
  const withTrailing = new Uint8Array(dangling.length + 3)
  withTrailing.set(dangling)
  new DataView(withTrailing.buffer).setUint32(4, withTrailing.length - 8, true)
  assert.equal(findForbiddenWebpChunk(withTrailing), 'MALFORMED', 'bytes incompletos dentro do RIFF')
})

test('metadata: o varredor só lê a lista de chunks (uma "EXIF" dentro do payload não conta)', () => {
  const bytes = webpWith([['VP8 ', 40]])
  bytes.set(Buffer.from('EXIF'), 30)
  bytes.set(Buffer.from('XMP '), 36)
  assert.equal(findForbiddenWebpChunk(bytes), null)
})
