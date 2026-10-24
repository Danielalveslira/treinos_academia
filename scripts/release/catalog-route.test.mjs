import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
const source = config.rewrites.find(({ destination }) => destination === '/app-shell.html').source
const pattern = new RegExp(`^${source.replace('/:path(', '/(')}$`)

test('catalog admin direct URLs use the app shell in production', () => {
  for (const path of ['/admin/exercicios', '/admin/exercicios-imagens', '/login', '/admin/parcerias']) {
    assert.ok(pattern.test(path), path)
  }
  for (const path of ['/admin/exercicios-unknown', '/assets/file.js', '/.finance-local/private.json']) {
    assert.equal(pattern.test(path), false, path)
  }
})
