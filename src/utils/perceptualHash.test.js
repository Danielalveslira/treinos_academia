import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dHashFromGrayscale, hammingDistanceHex, perceptualHashOfBlob } from './perceptualHash.js'

const flat = (value) => new Array(72).fill(value)
// gradiente decrescente em cada linha: todo pixel é mais claro que o vizinho da direita
const decreasing = () => Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 20)
const increasing = () => Array.from({ length: 72 }, (_, i) => (i % 9) * 20)

test('dHash: 64 bits em 16 hex; gradientes opostos dão hashes opostos; imagem lisa dá zero', () => {
  assert.equal(dHashFromGrayscale(decreasing()), 'ffffffffffffffff')
  assert.equal(dHashFromGrayscale(increasing()), '0000000000000000')
  assert.equal(dHashFromGrayscale(flat(128)), '0000000000000000')
  assert.match(dHashFromGrayscale(decreasing()), /^[0-9a-f]{16}$/)
})

test('dHash: a mesma imagem sempre dá o mesmo hash e brilho uniforme não muda a estrutura', () => {
  const base = decreasing()
  assert.equal(dHashFromGrayscale(base), dHashFromGrayscale(base.slice()))
  assert.equal(dHashFromGrayscale(base), dHashFromGrayscale(base.map((v) => Math.max(0, v - 10))))
})

test('dHash: entrada com tamanho errado falha (nada de hash inventado)', () => {
  assert.throws(() => dHashFromGrayscale([1, 2, 3]), /INVALID_GRAYSCALE/)
  assert.throws(() => dHashFromGrayscale(null), /INVALID_GRAYSCALE/)
})

test('distância de Hamming entre hashes', () => {
  assert.equal(hammingDistanceHex('0000000000000000', '0000000000000000'), 0)
  assert.equal(hammingDistanceHex('0000000000000000', '0000000000000001'), 1)
  assert.equal(hammingDistanceHex('ffffffffffffffff', '0000000000000000'), 64)
  assert.equal(hammingDistanceHex('f0f0f0f0f0f0f0f0', '0f0f0f0f0f0f0f0f'), 64)
  assert.throws(() => hammingDistanceHex('xyz', '0000000000000000'), /INVALID_HASH/)
})

test('sem navegador (sem createImageBitmap/canvas) o hash simplesmente não existe: null, nunca erro', async () => {
  assert.equal(await perceptualHashOfBlob({ size: 10 }), null)
})
