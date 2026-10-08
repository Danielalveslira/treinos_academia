import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHARE_HEIGHT, SHARE_WIDTH } from './shareProgressSvg.js'
import { buildShareText, SHARE_TITLE } from './shareText.js'
import {
  appUrl,
  buildSharePayload,
  copyText,
  downloadFile,
  nativeShare,
  shareWithFallback,
  renderSvgToBlob,
  renderSvgToPngBlob,
  renderSvgToPublishBlob,
  toPngFile,
  withTimeout,
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

test('a render that never answers (image never loads / toBlob never calls back) times out instead of hanging', async () => {
  const hanging = fakeEnv()
  hanging.Image = class {
    set src(value) {
      this.url = value // nunca dispara onload/onerror
    }
  }
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, Math.min(ms, 5), ...args)
  try {
    await assert.rejects(() => renderSvgToPngBlob('<svg/>', {}, hanging), /IMAGE_RENDER_TIMEOUT/)
    const silentEncoder = fakeEnv()
    silentEncoder.canvas.toBlob = () => {}
    await assert.rejects(
      () => renderSvgToPngBlob('<svg/>', {}, silentEncoder),
      /PNG_ENCODE_TIMEOUT/
    )
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
})

test('withTimeout passes the value through and does not leave a pending timer behind', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 60000, 'X'), 'ok')
  await assert.rejects(() => withTimeout(Promise.reject(new Error('boom')), 60000, 'X'), /boom/)
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

const TEXT = buildShareText('week', ORIGIN)

test('share payload carries files, title and text -- and NO separate url (the link lives inside the text)', () => {
  const payload = buildSharePayload(FILE, TEXT)
  assert.deepEqual(payload, { files: [FILE], title: 'Meu progresso no Evolutus', text: TEXT })
  assert.equal('url' in payload, false)
  assert.match(payload.text, new RegExp(`${ORIGIN}$`))
  assert.equal(appUrl({ location: { origin: 'https://x.vercel.app' } }), 'https://x.vercel.app')
  assert.equal(appUrl({}), null)
})

test('Compartilhar calls navigator.share ONCE with files + title + text when the device accepts files', async () => {
  const env = shareEnv()
  assert.equal(await nativeShare(FILE, TEXT, env), 'shared')
  assert.equal(env.calls.length, 1)
  assert.deepEqual(env.calls[0], { files: [FILE], title: SHARE_TITLE, text: TEXT })
  assert.ok(env.calls[0].text.includes(ORIGIN))
})

test('canShare is checked with the files payload before sharing', async () => {
  const seen = []
  const env = shareEnv({ canShare: (data) => (seen.push(data), true) })
  await nativeShare(FILE, TEXT, env)
  assert.deepEqual(seen[0].files, [FILE])
})

test('no file sharing / no canShare / no Web Share: "unsupported" and nothing is shared', async () => {
  for (const env of [
    shareEnv({ canShare: () => false }),
    shareEnv({ canShare: false }),
    shareEnv({ share: false }),
    {},
  ]) {
    assert.equal(await nativeShare(FILE, TEXT, env), 'unsupported')
    assert.equal(env.calls?.length ?? 0, 0)
  }
})

function downloadEnv(base) {
  const clicks = []
  return {
    clicks,
    env: {
      ...base,
      document: {
        createElement: () => ({
          click() {
            clicks.push(this)
          },
          remove() {},
        }),
        body: { appendChild() {} },
      },
      URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
      setTimeout: () => {},
    },
  }
}

test('fallback: copies the message AND downloads the image, then reports both', async () => {
  const written = []
  const base = shareEnv({
    canShare: () => false,
    clipboard: { writeText: async (t) => written.push(t) },
  })
  const { env, clicks } = downloadEnv(base)
  assert.equal(await shareWithFallback(FILE, TEXT, env), 'fallback_copied')
  assert.deepEqual(written, [TEXT])
  assert.equal(clicks.length, 1)
  assert.equal(clicks[0].download, FILE.name)
  assert.equal(base.calls.length, 0)
})

test('fallback with a failing/absent clipboard still downloads the image and says so (never throws or hangs)', async () => {
  const denied = {
    writeText: async () => {
      throw new Error('denied')
    },
  }
  for (const clipboard of [undefined, denied]) {
    const { env, clicks } = downloadEnv(shareEnv({ share: false, clipboard }))
    assert.equal(await shareWithFallback(FILE, TEXT, env), 'fallback_downloaded')
    assert.equal(clicks.length, 1)
  }
})

test('closing the native sheet (AbortError) is "cancelled" and does NOT trigger the fallback; real failures propagate', async () => {
  const cancelled = shareEnv({
    share: async () => {
      throw Object.assign(new Error('x'), { name: 'AbortError' })
    },
  })
  assert.equal(await shareWithFallback(FILE, TEXT, cancelled), 'cancelled')
  const broken = shareEnv({
    share: async () => {
      throw Object.assign(new Error('boom'), { name: 'NotAllowedError' })
    },
  })
  await assert.rejects(() => shareWithFallback(FILE, TEXT, broken), /boom/)
})

test('copyText reports failure honestly', async () => {
  const written = []
  assert.equal(
    await copyText('oi', { navigator: { clipboard: { writeText: async (t) => written.push(t) } } }),
    true
  )
  assert.deepEqual(written, ['oi'])
  assert.equal(await copyText('oi', { navigator: {} }), false)
  assert.equal(
    await copyText('', { navigator: { clipboard: { writeText: async () => {} } } }),
    false
  )
})

test('downloadFile never touches navigator.share', () => {
  const env = { ...fakeEnv(), navigator: { share: () => assert.fail('share must not run') } }
  downloadFile({ name: 'a.png' }, env)
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
