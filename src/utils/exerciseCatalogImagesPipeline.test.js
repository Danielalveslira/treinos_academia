import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  collectCatalogImageJobs,
  downloadImage,
  imageOutputPaths,
  inspectWebp,
  runImageBuild,
} from '../../scripts/exercise-catalog-images-core.mjs'

let directory
let jpeg

const catalog = {
  version: 1,
  exercises: [
    {
      id: 'Demo_Exercise',
      imageRefs: ['Demo_Exercise/0.jpg', 'Demo_Exercise/1.jpg'],
    },
  ],
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'catalog-images-'))
  jpeg = await sharp({
    create: { width: 1000, height: 500, channels: 3, background: '#336699' },
  })
    .jpeg()
    .toBuffer()
})

after(async () => {
  if (directory) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('pipeline inspection deduplicates refs and reports invalid refs', () => {
  const inspection = collectCatalogImageJobs({
    version: 1,
    exercises: [
      {
        id: 'Demo_Exercise',
        imageRefs: ['Demo_Exercise/0.jpg', 'Demo_Exercise/0.jpg', '../invalid.jpg'],
      },
    ],
  })
  assert.equal(inspection.jobs.length, 1)
  assert.deepEqual(inspection.duplicateRefs, ['Demo_Exercise/0.jpg'])
  assert.equal(inspection.invalidRefs.length, 1)
})

test('dry-run reports work without downloading or writing files', async () => {
  const outputRoot = join(directory, 'dry-run')
  let fetchCalls = 0
  const report = await runImageBuild({
    catalog,
    outputRoot,
    mode: 'dry-run',
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('dry-run não deve baixar')
    },
  })
  assert.equal(report.wouldDownload, 2)
  assert.equal(report.wouldGenerateThumbnails, 1)
  assert.equal(fetchCalls, 0)
  await assert.rejects(access(outputRoot))
})

test('apply converts proportional WebPs, creates one thumbnail and is idempotent', async () => {
  const outputRoot = join(directory, 'apply')
  let fetchCalls = 0
  const fetchImpl = async () => {
    fetchCalls += 1
    return new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } })
  }
  const first = await runImageBuild({
    catalog,
    outputRoot,
    mode: 'apply',
    fetchImpl,
  })
  assert.equal(first.downloaded, 2)
  assert.equal(first.generatedThumbnails, 1)
  assert.equal(fetchCalls, 2)

  const paths = imageOutputPaths(outputRoot, 1, {
    exerciseId: 'Demo_Exercise',
    sourceIndex: 0,
  })
  assert.deepEqual(await inspectWebp(paths.normal), {
    valid: true,
    size: (await inspectWebp(paths.normal)).size,
    width: 960,
    height: 480,
  })
  const thumbnail = await inspectWebp(paths.thumbnail)
  assert.equal(thumbnail.valid, true)
  assert.equal(thumbnail.width, 280)
  assert.equal(thumbnail.height, 140)

  const second = await runImageBuild({
    catalog,
    outputRoot,
    mode: 'apply',
    fetchImpl: async () => {
      throw new Error('arquivo válido não deve ser baixado novamente')
    },
  })
  assert.equal(second.downloaded, 0)
  assert.equal(second.processed, 0)
  assert.equal(second.existingImages, 2)
  assert.equal(second.existingThumbnails, 1)
})

test('apply identifies a 404 without creating an image', async () => {
  const outputRoot = join(directory, 'missing')
  const missingCatalog = {
    version: 1,
    exercises: [{ id: 'Missing', imageRefs: ['Missing/0.jpg'] }],
  }
  const report = await runImageBuild({
    catalog: missingCatalog,
    outputRoot,
    mode: 'apply',
    fetchImpl: async () => new Response(null, { status: 404 }),
  })
  assert.deepEqual(report.missing, ['Missing/0.jpg'])
  assert.equal(report.processed, 0)
})

test('download retries transient errors with bounded backoff', async () => {
  let attempts = 0
  const waits = []
  const result = await downloadImage('https://source.test/image.jpg', {
    fetchImpl: async () => {
      attempts += 1
      if (attempts < 3) return new Response(null, { status: 503 })
      return new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    },
    retries: 2,
    waitImpl: async (milliseconds) => waits.push(milliseconds),
  })
  assert.equal(result.length, jpeg.length)
  assert.equal(attempts, 3)
  assert.deepEqual(waits, [250, 500])
})
