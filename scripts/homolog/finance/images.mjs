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
// linux/amd64 config IDs observed, on a past run, after Docker verified the fixed official
// OCI index digests above. Used only by verifyLocalPostgresImage's own best-effort fast path
// (a bare-ID container Image, e.g. from a different harness) -- never by pullImage/cache.mjs,
// since a locally-assigned image.Id is NOT guaranteed to stay the same across daemon/
// containerd versions between runner images (that mismatch is exactly what caused "No such
// image" failures here before); verifiedTag()/verifyTaggedImage() are the reusable source of
// truth now, content-addressed against IMAGES itself rather than a frozen ID snapshot.
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
const inspectPlatform = (run, ref) => run('image', 'inspect', '--platform', 'linux/amd64', ref)
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

// `docker image inspect --platform <p> <ref>` can report a config ID for a manifest-list
// entry that is NOT directly runnable via `docker run <that id>` on every Docker/containerd
// storage backend -- observed for real in CI: the inspect above succeeds and logs an ID, then
// `docker run --pull=never <that id>` immediately reports "No such image". Docker's locally
// assigned image.Id is also not guaranteed stable across daemon/containerd versions between
// runner images, which is why VERIFIED_AMD64_IDS (a hardcoded snapshot of a past run's IDs)
// silently went stale. A `docker tag`-assigned name, in contrast, is always resolvable by
// `docker run`/`docker save`/`docker load` on the SAME daemon that created it, independent of
// that internal bookkeeping -- so pullImage always returns this tag, never a bare image.Id.
export const verifiedTag = key => `finance-verified/${key}:verified`

function matchesPinnedDigest(image, ref) {
  const [name, digest] = ref.split('@')
  return REGISTRIES.some((registry) => image?.RepoDigests?.includes(registry + name.split(':')[0] + '@' + digest))
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
  // Still returns the inspected image.Id: verifyLocalPostgresImage (a separate, unrelated
  // bare-ID fast path for a different harness) compares against it directly. pullImage below
  // never uses this return value for execution -- it always runs the stable tag instead (see
  // verifiedTag's comment for why the bare ID itself is not safe to run by).
  log(JSON.stringify({ image: ref, registry, verifiedDigest: digest, imageId: image.Id, platform: image.Os + '/' + image.Architecture }))
  return image.Id
}

// True only if the stable tag already exists locally and still matches the pinned digest for
// some trusted registry (content-addressed, so it is irrelevant which registry originally
// supplied it). Used both to recognize a complete OCI cache restore and, internally, right
// after a fresh pull/tag, to confirm the tag really points at the verified content.
export function verifyTaggedImage(key, run) {
  let raw
  try { raw = run('image', 'inspect', verifiedTag(key)) } catch { return false }
  let image
  try { image = JSON.parse(raw)?.[0] } catch { return false }
  return matchesPinnedDigest(image, IMAGES[key]) && image?.Os === 'linux' && image?.Architecture === 'amd64'
}

export async function pullImage(key, { run = docker, sleep = ms => new Promise(r => setTimeout(r, ms)), log = console.log } = {}) {
  if (!Object.hasOwn(IMAGES, key)) throw new Error('UNKNOWN_STACK_IMAGE')
  const ref = IMAGES[key]
  const tag = verifiedTag(key)
  if (process.env.FINANCE_OCI_CACHE_LOADED === '1') {
    if (!verifyTaggedImage(key, run)) throw new Error('IMAGE_INTEGRITY_FAILED: verified OCI cache image missing')
    log(JSON.stringify({ image: ref, verifiedTag: tag, source: 'verified-actions-cache', platform: 'linux/amd64' }))
    return tag
  }
  for (const registry of REGISTRIES) {
    const full = registry + ref
    let cached
    try { cached = inspectPlatform(run, full) }
    catch (error) {
      if (!/no such image|not found/i.test(message(error)) || integrityFailure(error)) throw error
    }
    if (cached !== undefined) {
      verify(cached, ref, registry, log)
      run('tag', full, tag)
      return tag
    }
    for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
      try { run('pull', '--platform', 'linux/amd64', full) }
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
      verify(inspectPlatform(run, full), ref, registry, log)
      run('tag', full, tag)
      return tag
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
