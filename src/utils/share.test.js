import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCommunityLink, buildShareText, canShareNatively } from './share.js'

test('buildCommunityLink points to the public community route, nothing else', () => {
  assert.equal(
    buildCommunityLink('gym', 'https://app.example.com'),
    'https://app.example.com/comunidades/gym'
  )
})

test('buildShareText embeds only the app name and the community link', () => {
  const text = buildShareText('gym', 'https://app.example.com')
  assert.match(text, /Evolutus/)
  assert.match(text, /https:\/\/app\.example\.com\/comunidades\/gym/)
  assert.doesNotMatch(text, /firestore|statuses\/|token/i)
})

test('canShareNatively reflects navigator.share availability', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { share: () => {} }, configurable: true })
  assert.equal(canShareNatively(), true)
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
  assert.equal(canShareNatively(), false)
  if (original) Object.defineProperty(globalThis, 'navigator', original)
})
