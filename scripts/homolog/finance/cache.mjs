// The cache is only a transport optimization. The pinned registry digests in IMAGES remain
// authoritative even when Actions reports a cache hit -- verifyTaggedImage checks the stable
// tag's RepoDigests against them, never a frozen Docker-internal image ID (see images.mjs for
// why that ID is not safe to hardcode/compare across runner images).
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { IMAGES, pullImage, verifiedTag, verifyTaggedImage } from './images.mjs'

const archive = '/tmp/finance-oci-cache/images.tar'
const keys = Object.keys(IMAGES)
const docker = (...args) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000,
}).trim()

export async function restoreCache({ run = docker, acquire = pullImage, record = line => appendFileSync(process.env.GITHUB_ENV, line), log = console.log } = {}) {
  let loaded = false
  try {
    run('load', '--input', archive)
    loaded = true
  } catch {
    log('OCI cache archive unavailable or incomplete; verifying pinned registry images')
  }
  const missing = keys.filter(key => !verifyTaggedImage(key, run))
  if (missing.length) {
    log(`OCI cache missing ${missing.length} verified image(s); restoring from pinned official digests`)
    // pullImage permits only verified official GHCR/ECR refs; failure remains fatal.
    for (const key of missing) {
      const tag = await acquire(key, { run, log })
      if (tag !== verifiedTag(key) || !verifyTaggedImage(key, run))
        throw new Error('IMAGE_INTEGRITY_FAILED: pinned config mismatch for ' + key)
    }
  }
  if (!keys.every(key => verifyTaggedImage(key, run)))
    throw new Error('IMAGE_INTEGRITY_FAILED: OCI cache could not be recovered')
  record('FINANCE_OCI_CACHE_LOADED=1\n')
  log(loaded && !missing.length ? 'Verified complete OCI cache without registry downloads' : 'Verified all pinned OCI images after cache recovery')
}

export async function saveCache({ run = docker, acquire = pullImage, log = console.log } = {}) {
  const tags = []
  for (const key of keys) {
    const tag = await acquire(key, { run, log })
    if (tag !== verifiedTag(key) || !verifyTaggedImage(key, run))
      throw new Error('IMAGE_INTEGRITY_FAILED: pinned config mismatch for ' + key)
    tags.push(tag)
  }
  mkdirSync('/tmp/finance-oci-cache', { recursive: true })
  run('save', '--output', archive, ...tags)
  log('Saved five verified pinned linux/amd64 images for the Actions cache')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'restore') {
    if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV required')
    await restoreCache()
  } else if (process.argv[2] === 'save') await saveCache()
  else throw new Error('Expected restore or save')
}
