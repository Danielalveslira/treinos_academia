// Bound actual streamed bytes, not the untrusted Content-Length header. Shared by
// inbound payment requests and provider responses. Cancel on overflow/stalled body.
export async function readLimitedJson(message, { maxBytes = 16384, timeoutMs = 5000 } = {}) {
  const length = message.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    void message.body?.cancel().catch(() => {})
    throw new Error('BODY_TOO_LARGE')
  }
  if (!message.body) throw new Error('INVALID_JSON')
  const reader = message.body.getReader()
  const chunks = []
  let size = 0
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('BODY_TIMEOUT')), timeoutMs)
  })
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout])
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('BODY_TOO_LARGE')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('INVALID_JSON')
    return result
  } catch (error) {
    // Cancellation may itself wait for the underlying source; never wait for it.
    void reader.cancel().catch(() => {})
    if (['BODY_TOO_LARGE', 'BODY_TIMEOUT'].includes(error.message)) throw error
    throw new Error('INVALID_JSON')
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

export function bodyErrorStatus(error) {
  return error?.message === 'BODY_TOO_LARGE' ? 413 : error?.message === 'BODY_TIMEOUT' ? 408 : 400
}
