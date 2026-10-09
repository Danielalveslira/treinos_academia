import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedAdImage } from './adImage.js'

const trusted = ['https://proj.supabase.co', 'https://app.evolutus.example']

test('imagem do Storage do projeto ou da própria origem é confiável', () => {
  assert.equal(
    isTrustedAdImage('https://proj.supabase.co/storage/v1/object/public/ads/a.webp', trusted),
    true
  )
  assert.equal(isTrustedAdImage('https://app.evolutus.example/img/a.webp', trusted), true)
})

test('terceiros, http, relativas e lixo não são confiáveis', () => {
  assert.equal(isTrustedAdImage('https://cdn.marca.com/a.jpg', trusted), false)
  assert.equal(isTrustedAdImage('http://proj.supabase.co/a.jpg', trusted), false)
  assert.equal(isTrustedAdImage('https://proj.supabase.co.evil.com/a.jpg', trusted), false)
  assert.equal(isTrustedAdImage('/img/a.jpg', trusted), false)
  assert.equal(isTrustedAdImage('', trusted), false)
  assert.equal(isTrustedAdImage('https://x.com/a.jpg', []), false)
})
