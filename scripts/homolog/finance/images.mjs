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
const REGISTRIES = ['ghcr.io/supabase/', 'public.ecr.aws/supabase/']
const docker = (...args) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000,
}).trim()
const message = error => String(error.stderr || error.message || error)
const unavailable = error => /toomanyrequests|too many requests|rate exceeded|data limit exceeded|\b429\b|\b50[234]\b|timed?\s*out|ETIMEDOUT|ECONNRESET|EAI_AGAIN|connection reset|connection refused|temporary failure|no such host|manifest unknown/i.test(message(error))
const integrityFailure = error => /digest mismatch|checksum mismatch|verification failed|unexpected digest|certificate|unauthorized|authentication required|denied|forbidden/i.test(message(error))

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
  for (const registry of REGISTRIES) {
    const full = registry + ref
    let cached
    try { cached = run('image', 'inspect', full) }
    catch (error) {
      if (!/no such image|not found/i.test(message(error)) || integrityFailure(error)) throw error
    }
    if (cached !== undefined) return verify(cached, ref, registry, log)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { run('pull', full) }
      catch (error) {
        // Only availability failures may retry/fall back. Security, auth, and unknown
        // failures remain fatal, even if their text also contains a transient marker.
        if (integrityFailure(error) || !unavailable(error)) throw error
        log(`Image registry unavailable: ${full}; attempt ${attempt}/2`)
        if (attempt === 2) break
        await sleep(2000)
        continue
      }
      // A successful pull with a bad/missing digest must never try another registry.
      return verify(run('image', 'inspect', full), ref, registry, log)
    }
  }
  throw new Error('STACK_IMAGE_UNAVAILABLE: ' + ref)
}
