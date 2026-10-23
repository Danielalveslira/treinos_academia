import test from 'node:test'
import assert from 'node:assert/strict'
import { readLimitedJson } from '../_shared/limitedJson.js'

const encoder = new TextEncoder()
function message(chunks, headers = {}, onCancel = () => {}) {
  return new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close() },
    cancel: onCancel,
  }), { headers })
}
test('actual byte limit applies without length and with a lying header', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    await assert.rejects(readLimitedJson(message(['{"a":"', 'á'.repeat(100), '"}'], headers), { maxBytes: 100 }), /BODY_TOO_LARGE/)
  }
  await assert.rejects(readLimitedJson(message(['{}'], { 'content-length': '99999' })), /BODY_TOO_LARGE/)
})
test('JSON is parsed only after bounded bytes and rejects invalid UTF8, arrays and scalars', async () => {
  assert.deepEqual(await readLimitedJson(message(['{"a":', '1}'])), { a: 1 })
  for (const value of ['null', '[]', '1', '{', '"a"']) await assert.rejects(readLimitedJson(message([value])), /INVALID_JSON/)
  await assert.rejects(readLimitedJson(new Response(new Uint8Array([255]))), /INVALID_JSON/)
})
test('stalled streams are cancelled within a bounded time', async () => {
  let cancelled = false
  const stalled = new Response(new ReadableStream({ cancel() { cancelled = true } }))
  await assert.rejects(readLimitedJson(stalled, { timeoutMs: 20 }), /BODY_TIMEOUT/)
  assert.equal(cancelled, true)
})

test('oversized declared body never waits for an uncooperative cancel hook', async () => {
  const source = new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { headers: { 'content-length': '99999' } })
  await assert.rejects(readLimitedJson(source), /BODY_TOO_LARGE/)
})
