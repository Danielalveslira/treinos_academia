import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHARE_HEIGHT, SHARE_WIDTH } from './shareProgressSvg.js'
import {
  canShareImageFiles,
  downloadFile,
  renderSvgToPngBlob,
  shareImageFile,
  toPngFile,
} from './shareImage.js'

// Fakes de navegador: nenhum canvas/Image real é necessário (o projeto não usa jsdom).
function fakeEnv({
  imageFails = false,
  noContext = false,
  blob = { size: 10, type: 'image/png' },
} = {}) {
  const drawn = []
  const clicks = []
  const timers = []
  const revoked = []
  class FakeImage {
    set src(value) {
      this.url = value
      Promise.resolve().then(() => (imageFails ? this.onerror() : this.onload()))
    }
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (noContext ? null : { drawImage: (...args) => drawn.push(args) }),
    toBlob: (callback, type) => callback(blob && { ...blob, type }),
  }
  return {
    drawn,
    clicks,
    timers,
    revoked,
    canvas,
    Image: FakeImage,
    File: class {
      constructor(parts, name, options) {
        this.parts = parts
        this.name = name
        this.type = options.type
      }
    },
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: (url) => revoked.push(url) },
    setTimeout: (fn) => timers.push(fn),
    document: {
      createElement: (tag) =>
        tag === 'canvas'
          ? canvas
          : {
              click() {
                clicks.push(this)
              },
              remove() {},
              set href(v) {
                this._href = v
              },
              get href() {
                return this._href
              },
            },
      body: { appendChild() {} },
    },
    navigator: {},
  }
}

test('renders the SVG into a 1080x1350 canvas with a single drawImage and returns a PNG blob', async () => {
  const env = fakeEnv()
  const blob = await renderSvgToPngBlob('<svg/>', {}, env)
  assert.equal(blob.type, 'image/png')
  assert.equal(env.canvas.width, SHARE_WIDTH)
  assert.equal(env.canvas.height, SHARE_HEIGHT)
  assert.equal(env.drawn.length, 1)
  assert.deepEqual(env.drawn[0].slice(1), [0, 0, SHARE_WIDTH, SHARE_HEIGHT])
})

test('rendering failures are explicit errors (image load, canvas context, PNG encode)', async () => {
  await assert.rejects(
    () => renderSvgToPngBlob('<svg/>', {}, fakeEnv({ imageFails: true })),
    /IMAGE_RENDER_FAILED/
  )
  await assert.rejects(
    () => renderSvgToPngBlob('<svg/>', {}, fakeEnv({ noContext: true })),
    /CANVAS_UNAVAILABLE/
  )
  await assert.rejects(
    () => renderSvgToPngBlob('<svg/>', {}, fakeEnv({ blob: null })),
    /PNG_ENCODE_FAILED/
  )
})

test('toPngFile wraps the blob as image/png with the given name', () => {
  const env = fakeEnv()
  const file = toPngFile({ size: 1 }, 'evolutus-week.png', env)
  assert.equal(file.name, 'evolutus-week.png')
  assert.equal(file.type, 'image/png')
})

test('file sharing is only offered when the browser supports share + canShare with files', () => {
  const file = { name: 'a.png' }
  assert.equal(canShareImageFiles(file, { navigator: {} }), false)
  assert.equal(canShareImageFiles(file, { navigator: { share() {} } }), false)
  assert.equal(canShareImageFiles(file, { navigator: { share() {}, canShare: () => true } }), true)
  assert.equal(
    canShareImageFiles(file, { navigator: { share() {}, canShare: () => false } }),
    false
  )
  assert.equal(
    canShareImageFiles(file, {
      navigator: {
        share() {},
        canShare: () => {
          throw new Error('x')
        },
      },
    }),
    false
  )
  assert.equal(canShareImageFiles(file, {}), false)
})

test('sharing: success, user cancel (AbortError is NOT an error) and real failures', async () => {
  const calls = []
  const ok = { navigator: { share: async (payload) => calls.push(payload) } }
  assert.equal(
    await shareImageFile({ name: 'a.png' }, { title: 'Evolutus', text: 't' }, ok),
    'shared'
  )
  assert.deepEqual(
    calls[0].files.map((f) => f.name),
    ['a.png']
  )
  const cancelled = {
    navigator: {
      share: async () => {
        throw Object.assign(new Error('x'), { name: 'AbortError' })
      },
    },
  }
  assert.equal(await shareImageFile({ name: 'a.png' }, {}, cancelled), 'cancelled')
  const broken = {
    navigator: {
      share: async () => {
        throw Object.assign(new Error('boom'), { name: 'NotAllowedError' })
      },
    },
  }
  await assert.rejects(() => shareImageFile({ name: 'a.png' }, {}, broken), /boom/)
})

test('download: clicks an anchor with the file name and revokes the object URL afterwards', () => {
  const env = fakeEnv()
  downloadFile({ name: 'evolutus-month.png' }, env)
  assert.equal(env.clicks.length, 1)
  assert.equal(env.clicks[0].download, 'evolutus-month.png')
  assert.equal(env.revoked.length, 0)
  env.timers[0]()
  assert.deepEqual(env.revoked, ['blob:fake'])
})
