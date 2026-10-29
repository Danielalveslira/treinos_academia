// The cache is created only after pullImage verifies every official OCI index.
// GitHub Actions stores it under an immutable key on the trusted main branch.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { IMAGES, VERIFIED_AMD64_IDS, pullImage } from './images.mjs'

const archive = '/tmp/finance-oci-cache/images.tar'
const keys = Object.keys(IMAGES)
const docker = (...args) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000,
}).trim()
const inspect = id => JSON.parse(docker('image', 'inspect', id))?.[0]
const verify = (key, id) => {
  const image = inspect(id)
  if (id !== VERIFIED_AMD64_IDS[key] || image?.Id !== id || image?.Os !== 'linux' || image?.Architecture !== 'amd64')
    throw new Error('IMAGE_INTEGRITY_FAILED: cached config mismatch for ' + key)
}

if (process.argv[2] === 'restore') {
  docker('load', '--input', archive)
  for (const key of keys) verify(key, VERIFIED_AMD64_IDS[key])
  if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV required')
  appendFileSync(process.env.GITHUB_ENV, 'FINANCE_OCI_CACHE_LOADED=1\n')
  console.log('Verified all five cached linux/amd64 image configuration digests')
} else if (process.argv[2] === 'save') {
  const ids = []
  for (const key of keys) {
    const id = await pullImage(key)
    verify(key, id)
    ids.push(id)
  }
  mkdirSync('/tmp/finance-oci-cache', { recursive: true })
  docker('save', '--output', archive, ...ids)
  console.log('Saved five verified official images for the Actions cache')
} else throw new Error('Expected restore or save')
