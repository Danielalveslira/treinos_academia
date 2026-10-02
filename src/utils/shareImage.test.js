import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHARE_HEIGHT, SHARE_WIDTH } from './shareProgressSvg.js'
import {
  SHARE_TEXT,
  SHARE_TITLE,
  appUrl,
  buildSharePayload,
  copyAppLink,
  downloadFile,
  nativeShare,
  renderSvgToBlob,
  renderSvgToPngBlob,
  renderSvgToPublishBlob,
  toPngFile,
} from './shareImage.js'

// Fakes de navegador: nenhum canvas/Image real é necessário (o projeto não usa jsdom).
function fakeEnv({
  imageFails = false,
  noContext = false,
  blob = { size: 10, type: 'image/png' },
  forceType,
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
    toBlob: (callback, type) => callback(blob && { ...blob, type: forceType || type }),
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

test('download: clicks an anchor with the file name and revokes the object URL afterwards', () => {
  const env = fakeEnv()
  downloadFile({ name: 'evolutus-month.png' }, env)
  assert.equal(env.clicks.length, 1)
  assert.equal(env.clicks[0].download, 'evolutus-month.png')
  assert.equal(env.revoked.length, 0)
  env.timers[0]()
  assert.deepEqual(env.revoked, ['blob:fake'])
})

const FILE = { name: 'evolutus-week.png', type: 'image/png' }
const ORIGIN = 'https://evolutus.example'
function shareEnv({ share, canShare, clipboard } = {}) {
  const calls = []
  return {
    calls,
    location: { origin: ORIGIN },
    navigator: {
      ...(share === false
        ? {}
        : {
            share: async (data) => {
              calls.push(data)
              if (share) await share(data)
            },
          }),
      ...(canShare === undefined
        ? { canShare: () => true }
        : canShare === false
          ? {}
          : { canShare }),
      ...(clipboard ? { clipboard } : {}),
    },
  }
}

test('share payload carries the image, the title, the message and the app URL (origin of the running app)', () => {
  const payload = buildSharePayload(FILE, { location: { origin: ORIGIN } })
  assert.deepEqual(payload.files, [FILE])
  assert.equal(payload.title, 'Meu progresso no Evolutus')
  assert.equal(
    payload.text,
    'Olha meu progresso no Evolutus 💪\nVenha acompanhar sua evolução também!'
  )
  assert.equal(payload.url, ORIGIN)
  assert.equal(appUrl({ location: { origin: 'https://x.vercel.app' } }), 'https://x.vercel.app')
  assert.equal(appUrl({}), null)
  assert.equal('url' in buildSharePayload(FILE, {}), false)
})

test('Compartilhar calls the native share ONCE with image + text + URL when the device accepts it', async () => {
  const env = shareEnv()
  assert.equal(await nativeShare(FILE, env), 'shared')
  assert.equal(env.calls.length, 1)
  assert.deepEqual(env.calls[0], {
    title: SHARE_TITLE,
    text: SHARE_TEXT,
    url: ORIGIN,
    files: [FILE],
  })
})

test('canShare is checked with the files payload before sharing', async () => {
  const seen = []
  const env = shareEnv({ canShare: (data) => (seen.push(data), true) })
  await nativeShare(FILE, env)
  assert.deepEqual(seen[0].files, [FILE])
})

test('a device that refuses file + url together still gets the link: it moves into the text, image kept', async () => {
  const env = shareEnv({ canShare: (data) => !('url' in data) })
  assert.equal(await nativeShare(FILE, env), 'shared')
  assert.deepEqual(env.calls[0].files, [FILE])
  assert.equal(env.calls[0].text, `${SHARE_TEXT}\n${ORIGIN}`)
  assert.equal('url' in env.calls[0], false)
})

test('no file sharing support: shares text + URL natively and NEVER downloads', async () => {
  const downloads = []
  const env = {
    ...shareEnv({ canShare: () => false }),
    URL: { createObjectURL: () => (downloads.push('url'), 'blob:x') },
  }
  assert.equal(await nativeShare(FILE, env), 'shared_text')
  assert.deepEqual(env.calls[0], { title: SHARE_TITLE, text: SHARE_TEXT, url: ORIGIN })
  assert.equal(env.calls[0].files, undefined)
  assert.deepEqual(downloads, [])
})

test('no Web Share at all: "unsupported" -- nothing is shared and nothing is downloaded', async () => {
  const downloads = []
  const env = {
    ...shareEnv({ share: false }),
    URL: { createObjectURL: () => (downloads.push('url'), 'blob:x') },
    document: {
      createElement: () => {
        downloads.push('a')
      },
    },
  }
  assert.equal(await nativeShare(FILE, env), 'unsupported')
  assert.deepEqual(downloads, [])
  assert.equal(await nativeShare(FILE, {}), 'unsupported')
})

test('closing the native sheet (AbortError) is "cancelled", not an error; real failures propagate', async () => {
  const cancelled = shareEnv({
    share: async () => {
      throw Object.assign(new Error('x'), { name: 'AbortError' })
    },
  })
  assert.equal(await nativeShare(FILE, cancelled), 'cancelled')
  const broken = shareEnv({
    share: async () => {
      throw Object.assign(new Error('boom'), { name: 'NotAllowedError' })
    },
  })
  await assert.rejects(() => nativeShare(FILE, broken), /boom/)
})

test('copy link fallback: explicit, uses the app origin, and reports failure honestly', async () => {
  const written = []
  assert.equal(
    await copyAppLink({
      location: { origin: ORIGIN },
      navigator: { clipboard: { writeText: async (t) => written.push(t) } },
    }),
    true
  )
  assert.deepEqual(written, [ORIGIN])
  assert.equal(await copyAppLink({ location: { origin: ORIGIN }, navigator: {} }), false)
  assert.equal(
    await copyAppLink({
      location: { origin: ORIGIN },
      navigator: {
        clipboard: {
          writeText: async () => {
            throw new Error('denied')
          },
        },
      },
    }),
    false
  )
  assert.equal(
    await copyAppLink({ navigator: { clipboard: { writeText: async () => {} } } }),
    false
  )
})

test('download and share are fully separate code paths: downloadFile never touches navigator.share', () => {
  const env = fakeEnv()
  let shared = 0
  env.navigator = { share: () => (shared += 1) }
  downloadFile({ name: 'a.png' }, env)
  assert.equal(shared, 0)
  assert.equal(env.clicks.length, 1)
})

test('publishing renders WebP (the bucket only accepts image/webp), re-encoding smaller when over the limit', async () => {
  const env = fakeEnv({ blob: { size: 1000, type: 'image/webp' } })
  const blob = await renderSvgToPublishBlob('<svg/>', env)
  assert.equal(blob.type, 'image/webp')
  await assert.rejects(
    () =>
      renderSvgToBlob(
        '<svg/>',
        { type: 'image/webp' },
        fakeEnv({ blob: { size: 1 }, forceType: 'image/png' })
      ),
    /IMAGE_TYPE_UNSUPPORTED/
  )
  await assert.rejects(
    () =>
      renderSvgToPublishBlob(
        '<svg/>',
        fakeEnv({ blob: { size: 5 * 1024 * 1024, type: 'image/webp' } })
      ),
    /IMAGE_TOO_LARGE/
  )
})
