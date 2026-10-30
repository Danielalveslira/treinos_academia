import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saveWithImage } from './storefrontImageSave.js'

function scenario({ saveFails = false, linked = false, readFails = false, cleanupFails = false, uploadFails = false } = {}) {
  const calls = []
  const options = {
    file: { name: 'new.png' },
    previousMediaId: 'old',
    upload: async () => {
      calls.push('upload')
      if (uploadFails) throw Error('upload')
      return 'new'
    },
    save: async (id) => {
      calls.push(`save:${id}`)
      if (saveFails) throw Error('save')
    },
    isLinked: async (id) => {
      calls.push(`read:${id}`)
      if (readFails) throw Error('read')
      return linked
    },
    discard: async (id) => {
      calls.push(`discard:${id}`)
      if (cleanupFails) throw Error('cleanup')
    },
  }
  return { calls, options }
}

test('confirmed save discards only the previous image, even when cleanup fails', async () => {
  const { calls, options } = scenario({ cleanupFails: true })
  await saveWithImage(options)
  assert.deepEqual(calls, ['upload', 'save:new', 'discard:old'])
})

test('lost save response with a linked upload is reconciled as success', async () => {
  const { calls, options } = scenario({ saveFails: true, linked: true })
  await saveWithImage(options)
  assert.deepEqual(calls, ['upload', 'save:new', 'read:new', 'discard:old'])
})

test('failed save with unlinked upload discards only the new orphan', async () => {
  const { calls, options } = scenario({ saveFails: true })
  await assert.rejects(saveWithImage(options), /save/)
  assert.deepEqual(calls, ['upload', 'save:new', 'read:new', 'discard:new'])
})

test('failed reconciliation preserves upload when commit outcome is unknown', async () => {
  const { calls, options } = scenario({ saveFails: true, readFails: true })
  await assert.rejects(saveWithImage(options), /save/)
  assert.deepEqual(calls, ['upload', 'save:new', 'read:new'])
})

test('upload failure never saves or discards', async () => {
  const { calls, options } = scenario({ uploadFails: true })
  await assert.rejects(saveWithImage(options), /upload/)
  assert.deepEqual(calls, ['upload'])
})

test('editing without a new file saves without image operations', async () => {
  const { calls, options } = scenario()
  options.file = null
  await saveWithImage(options)
  assert.deepEqual(calls, ['save:null'])
})
