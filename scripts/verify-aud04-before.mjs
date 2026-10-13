// Read-only reproduction of the original defects using the original Git blob and mocks.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
const source = execFileSync(
  'git',
  ['cat-file', 'blob', '4a7f2b3ed3fa0f3b7a297e3c59b983e792e1a072'],
  { encoding: 'utf8' }
)
const { processDeletionJobs } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
)
let removed
const admin = {
  rpc: async (name) => ({
    data:
      name === 'list_pending_deletion_jobs'
        ? [{ id: 'synthetic' }]
        : { complete: true, photoPaths: ['statusPhotos/c/s.webp'] },
    error: null,
  }),
  storage: {
    from: (bucket) => ({
      remove: async (paths) => {
        removed = { bucket, paths }
        return { error: { status: 503 } }
      },
    }),
  },
}
const result = await processDeletionJobs(admin, { log() {}, error() {} })
assert.deepEqual(removed, { bucket: 'status-photos', paths: ['statusPhotos/c/s.webp'] })
assert.equal(result.processed, 1)
assert.equal(result.errored, 0)
console.log('REPRODUCED: prefix sent unchanged; SDK error counted as success')
