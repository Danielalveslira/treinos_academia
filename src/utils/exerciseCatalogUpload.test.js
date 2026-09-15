import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  remoteFileIsCurrent,
  storagePathForLocalFile,
} from '../../scripts/upload-exercise-catalog-images.mjs'

test('uploader maps generated files only into the public versioned namespace', () => {
  const root = join('tmp', 'generated')
  assert.equal(
    storagePathForLocalFile(join(root, 'v1', 'Barbell_Deadlift', 'thumb.webp'), root),
    'exercise-catalog/v1/Barbell_Deadlift/thumb.webp'
  )
  assert.throws(() => storagePathForLocalFile(join(root, 'v1', 'Barbell_Deadlift', '0.jpg'), root))
})

test('uploader skips only byte-identical files with the required immutable metadata', () => {
  const metadata = {
    contentType: 'image/webp',
    cacheControl: 'public,max-age=31536000,immutable',
    size: '123',
    metadata: { catalogSha256: 'abc' },
  }
  assert.equal(remoteFileIsCurrent(metadata, 'abc', 123), true)
  assert.equal(remoteFileIsCurrent(metadata, 'different', 123), false)
  assert.equal(remoteFileIsCurrent({ ...metadata, cacheControl: 'no-cache' }, 'abc', 123), false)
})
