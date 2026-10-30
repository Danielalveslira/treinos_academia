// Official mirrors were checked to serve these identical OCI index digests.
// Version/digest updates require review; never resolve a mutable tag at runtime.
import { execFileSync } from 'node:child_process'

export const IMAGES = Object.freeze({
  postgres: 'postgres:17.6.1.166@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86',
  gotrue: 'gotrue:v2.197.0@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b',
  storageApi: 'storage-api:v1.77.5@sha256:4ae1890ba0c6fd24d975c34f3aa201a01d410171c8ba6eddeb675ef92341a62d',
  postgrest: 'postgrest:v14.5@sha256:b574528fe109c8343c1247155734d03df8c34b462f342dca0ccc20244fc36ef9',
  edgeRuntime: 'edge-runtime:v1.77.1@sha256:645d0e45446181f3e9d87efeef637b494615f32365befff00e2d2b0fe8535fef',
})
// linux/amd64 config IDs observed after Docker verified the fixed official OCI
// index digests. An Actions cache may restore these exact content-addressed
// images without a registry request; changing a digest requires reviewing its ID.
export const VERIFIED_AMD64_IDS = Object.freeze({
  postgres: 'sha256:f55775729ea7a38743f61e2bb4f9bb1e17eaaeaccb39879ae9d9d3cb1c4cb456',
  gotrue: 'sha256:1181bff5ba4ce440013a63cef9f4cf13024c432d705c9b1fbc9e5b949e852f48',
  storageApi: 'sha256:d2aaa7622da45e8ae4113755a5fdf472692cf321b3a65989a7416dd38984d664',
  postgrest: 'sha256:af0a6dad76305650c215449d905a124ae5ad3bcd0f04c01845a0cea17d4e0960',
  edgeRuntime: 'sha256:4a984fc0315d44a0141749d4851d46ff7ff21e8b57df9a9c460fd6ca1e3caab8',
})
const REGISTRIES = ['ghcr.io/supabase/', 'public.ecr.aws/supabase/']
const RETRY_DELAYS_MS = [2000, 8000]
const docker = (...args) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000,
}).trim()
const message = error => String(error.stderr || error.message || error)
const unavailable = error => /toomanyrequests|too many requests|rate exceeded|data limit exceeded|\b429\b|\b50[234]\b|timed?\s*out|ETIMEDOUT|ECONNRESET|EAI_AGAIN|connection reset|connection refused|temporary failure|no such host|manifest unknown/i.test(message(error))
const integrityFailure = error => /digest mismatch|checksum mismatch|verification failed|unexpected digest|certificate|unauthorized|authentication required|denied|forbidden/i.test(message(error))
const unavailableReason = error => {
  const detail = message(error)
  if (/toomanyrequests|too many requests|rate exceeded|data limit exceeded|\b429\b/i.test(detail)) return 'rate_limit'
  if (/manifest unknown/i.test(detail)) return 'manifest_unavailable'
  if (/\b50[234]\b/i.test(detail)) return 'server_unavailable'
  if (/timed?\s*out|ETIMEDOUT/i.test(detail)) return 'timeout'
  return 'network_unavailable'
}

function verify(raw, ref, registry, log) {
  let images
  try { images = JSON.parse(raw) } catch { throw new Error('IMAGE_INTEGRITY_FAILED: invalid inspect response') }
  const image = images?.[0]
  const [name, digest] = ref.split('@')
  const expected = registry + name.split(':')[0] + '@' + digest
  if (!Array.isArray(images) || images.length !== 1 || !image?.RepoDigests?.includes(expected) ||
      !/^sha256:[a-f0-9]{64}$/.test(image.Id) || image.Os !== 'linux' ||
      !['amd64', 'arm64'].includes(image.Architecture)) {
    throw new Error('IMAGE_INTEGRITY_FAILED: ' + expected)
  }
  // Docker verifies the pinned index, platform manifest, config and layer hashes on pull.
  // Execute the inspected immutable image ID, avoiding a subsequent tag lookup/pull.
  log(JSON.stringify({ image: ref, registry, verifiedDigest: digest, imageId: image.Id, platform: image.Os + '/' + image.Architecture }))
  return image.Id
}

export async function pullImage(key, { run = docker, sleep = ms => new Promise(r => setTimeout(r, ms)), log = console.log } = {}) {
  if (!Object.hasOwn(IMAGES, key)) throw new Error('UNKNOWN_STACK_IMAGE')
  const ref = IMAGES[key]
  if (process.env.FINANCE_OCI_CACHE_LOADED === '1') {
    const expectedId = VERIFIED_AMD64_IDS[key]
    let cached
    try { cached = JSON.parse(run('image', 'inspect', expectedId))?.[0] }
    catch { throw new Error('IMAGE_INTEGRITY_FAILED: verified OCI cache image missing') }
    if (cached?.Id !== expectedId || cached?.Os !== 'linux' || cached?.Architecture !== 'amd64')
      throw new Error('IMAGE_INTEGRITY_FAILED: verified OCI cache image mismatch')
    log(JSON.stringify({ image: ref, verifiedConfigId: expectedId, source: 'verified-actions-cache', platform: 'linux/amd64' }))
    return expectedId
  }
  for (const registry of REGISTRIES) {
    const full = registry + ref
    let cached
    try { cached = run('image', 'inspect', full) }
    catch (error) {
      if (!/no such image|not found/i.test(message(error)) || integrityFailure(error)) throw error
    }
    if (cached !== undefined) return verify(cached, ref, registry, log)
    for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
      try { run('pull', full) }
      catch (error) {
        // Only availability failures may retry/fall back. Security, auth, and unknown
        // failures remain fatal, even if their text also contains a transient marker.
        if (integrityFailure(error) || !unavailable(error)) throw error
        // Log only a safe category: Docker stderr may contain registry credentials.
        log(`Image registry unavailable (${unavailableReason(error)}): ${full}; attempt ${attempt}/${RETRY_DELAYS_MS.length + 1}`)
        if (attempt > RETRY_DELAYS_MS.length) break
        await sleep(RETRY_DELAYS_MS[attempt - 1])
        continue
      }
      // A successful pull with a bad/missing digest must never try another registry.
      return verify(run('image', 'inspect', full), ref, registry, log)
    }
  }
  throw new Error('STACK_IMAGE_UNAVAILABLE: ' + ref)
}

// The CLI names a versioned official image; our isolated harness executes the
// verified immutable config ID. An OCI index digest is not that config ID.
export function verifyLocalPostgresImage(info, { run = docker } = {}) {
  const requested = info?.Config?.Image || ''
  if (/^(?:(?:ghcr\.io|public\.ecr\.aws)\/)?supabase\/postgres:[0-9.]+(?:@sha256:[a-f0-9]{64})?$/.test(requested)) return
  if (!/^sha256:[a-f0-9]{64}$/.test(requested) || requested !== info?.Image)
    throw new Error('IMAGE_INTEGRITY_FAILED: unrecognized PostgreSQL image')
  const raw = run('image', 'inspect', info.Image)
  let image
  try { image = JSON.parse(raw)?.[0] } catch { throw new Error('IMAGE_INTEGRITY_FAILED: invalid inspect response') }
  if (process.env.FINANCE_OCI_CACHE_LOADED === '1' && info.Image === VERIFIED_AMD64_IDS.postgres &&
      image?.Id === info.Image && image?.Os === 'linux' && image?.Architecture === 'amd64') return
  const digest = IMAGES.postgres.split('@')[1]
  const registry = REGISTRIES.find((prefix) => image?.RepoDigests?.includes(prefix + 'postgres@' + digest))
  if (!registry || verify(raw, IMAGES.postgres, registry, () => {}) !== info.Image)
    throw new Error('IMAGE_INTEGRITY_FAILED: PostgreSQL config/index mismatch')
}
