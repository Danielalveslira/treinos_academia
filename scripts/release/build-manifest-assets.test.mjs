import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveManifestEntry } from '../build-manifest-assets.mjs'

test('public header includes every shared stylesheet once, before its own styles', () => {
  const manifest = {
    header: { isEntry: true, file: 'header.js', imports: ['menu', 'theme'], css: ['header.css'] },
    menu: { imports: ['theme'], css: ['menu.css'] },
    theme: { css: ['tokens.css'] },
  }
  assert.deepEqual(resolveManifestEntry(manifest, 'header'), {
    file: 'header.js',
    importedCss: ['tokens.css', 'menu.css'],
    css: ['header.css'],
  })
})
test('missing entry or CSS dependency fails the build rather than silently dropping styles', () => {
  assert.throws(() => resolveManifestEntry({}, 'header'), /entry missing/)
  assert.throws(
    () =>
      resolveManifestEntry(
        { header: { isEntry: true, file: 'h.js', imports: ['missing'] } },
        'header'
      ),
    /dependency missing/
  )
})
test('CSS shared through cyclic dependencies is included without recursion or duplication', () => {
  assert.deepEqual(
    resolveManifestEntry(
      {
        header: { isEntry: true, file: 'header.js', imports: ['a'] },
        a: { imports: ['b'], css: ['shared.css'] },
        b: { imports: ['a'], css: ['shared.css'] },
      },
      'header'
    ),
    { file: 'header.js', importedCss: ['shared.css'], css: [] }
  )
})
