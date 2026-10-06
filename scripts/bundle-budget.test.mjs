import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { compare, measure, parseBootAssets } from './bundle-budget.mjs'

const SW = 'const BOOT_ASSETS = ["/assets/a.js","/assets/a.css","/assets/b.js"]\nconst X = 1'

test('parseBootAssets lê a lista de precache do sw.js gerado', () => {
  assert.deepEqual(parseBootAssets(SW), ['/assets/a.js', '/assets/a.css', '/assets/b.js'])
})

test('parseBootAssets falha claramente sem a lista ou com lista vazia', () => {
  assert.throws(() => parseBootAssets('nada'), /BOOT_ASSETS/)
  assert.throws(() => parseBootAssets('const BOOT_ASSETS = []'), /vazio/)
})

test('measure soma gzip por tipo e conta os arquivos', () => {
  const files = {
    '/d/sw.js': Buffer.from(SW),
    '/d/assets/a.js': Buffer.from('x'.repeat(5000)),
    '/d/assets/a.css': Buffer.from('y'.repeat(3000)),
    '/d/assets/b.js': Buffer.from('z'.repeat(4000)),
  }
  const result = measure('/d/', (file) => files[file])
  const gz = (text) => gzipSync(Buffer.from(text), { level: 9 }).length
  assert.deepEqual(result, {
    bootJsGzipBytes: gz('x'.repeat(5000)) + gz('z'.repeat(4000)),
    bootCssGzipBytes: gz('y'.repeat(3000)),
    bootFiles: 3,
  })
})

test('compare aceita dentro da tolerância e acusa estouro e arquivo novo no precache', () => {
  const baseline = { bootJsGzipBytes: 1000, bootCssGzipBytes: 100, bootFiles: 4, tolerance: 0.1 }
  assert.deepEqual(compare({ bootJsGzipBytes: 1100, bootCssGzipBytes: 110, bootFiles: 4 }, baseline), [])
  const failures = compare({ bootJsGzipBytes: 1101, bootCssGzipBytes: 100, bootFiles: 5 }, baseline)
  assert.equal(failures.length, 2)
  assert.match(failures[0], /bootJsGzipBytes/)
  assert.match(failures[1], /bootFiles/)
})
