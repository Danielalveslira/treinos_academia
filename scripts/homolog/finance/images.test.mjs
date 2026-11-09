import test from 'node:test'
import assert from 'node:assert/strict'
import { IMAGES, VERIFIED_AMD64_IDS, pullImage, verifiedTag, verifyLocalPostgresImage } from './images.mjs'

const id = 'sha256:' + 'a'.repeat(64)
const ghcr = 'ghcr.io/supabase/'
const ecr = 'public.ecr.aws/supabase/'
const ref = registry => registry + IMAGES.postgres
const image = (registry, overrides = {}) => JSON.stringify([{
  Id: id, Os: 'linux', Architecture: 'amd64',
  RepoDigests: [registry + 'postgres@' + IMAGES.postgres.split('@')[1]], ...overrides,
}])
const missing = () => { throw new Error('No such image') }
const quiet = { log() {}, sleep: async () => {} }

test('trusted OCI cache uses only the stable verified tag without registry access', async () => {
  const previous = process.env.FINANCE_OCI_CACHE_LOADED
  process.env.FINANCE_OCI_CACHE_LOADED = '1'
  try {
    const result = await pullImage('postgres', { ...quiet, run: (...args) => {
      assert.deepEqual(args, ['image', 'inspect', verifiedTag('postgres')])
      return image(ghcr)
    } })
    assert.equal(result, verifiedTag('postgres'))
    // Right registry digest, wrong platform -- still rejected even though the tag exists.
    await assert.rejects(pullImage('postgres', { ...quiet, run: () => image(ghcr, { Architecture: 'arm64' }) }), /IMAGE_INTEGRITY_FAILED/)
    // Tag missing entirely (cache restore did not actually load it).
    await assert.rejects(pullImage('postgres', { ...quiet, run: () => { throw new Error('No such image') } }), /IMAGE_INTEGRITY_FAILED/)
    // Tag exists but points at content that never matched any pinned registry digest.
    await assert.rejects(pullImage('postgres', { ...quiet, run: () => image(ghcr, { RepoDigests: [] }) }), /IMAGE_INTEGRITY_FAILED/)
  } finally {
    if (previous === undefined) delete process.env.FINANCE_OCI_CACHE_LOADED
    else process.env.FINANCE_OCI_CACHE_LOADED = previous
  }
})

// VERIFIED_AMD64_IDS is legacy: only verifyLocalPostgresImage's own bare-ID fast path still
// reads it (see images.mjs) -- pullImage/cache.mjs no longer compare against it.
test('VERIFIED_AMD64_IDS still names exactly the five pinned images, for verifyLocalPostgresImage', () => {
  assert.equal(Object.keys(VERIFIED_AMD64_IDS).length, Object.keys(IMAGES).length)
})

// Regression: IMAGES keys are camelCase (storageApi, edgeRuntime) to match normal JS naming,
// but `docker tag`/`docker run` reject an uppercase repository name outright -- caught for
// real in CI ("repository name ... must be lowercase") the first time this ran against a
// camelCase key, since the local unit tests here only ever exercised 'postgres'.
test('verifiedTag is always a valid, lowercase Docker reference for every pinned key', () => {
  for (const key of Object.keys(IMAGES)) {
    assert.match(verifiedTag(key), /^finance-verified\/[a-z0-9._-]+:verified$/, key)
  }
})

test('all five original versions and OCI digests are fixed, with no mutable override', () => {
  assert.equal(Object.keys(IMAGES).length, 5)
  for (const ref of Object.values(IMAGES)) assert.match(ref, /^[\w-]+:[\d.v]+@sha256:[a-f0-9]{64}$/)
  assert.equal(IMAGES.postgres, 'postgres:17.6.1.166@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86')
  assert.ok(Object.isFrozen(IMAGES))
})
test('a cached registry image is tagged under the stable name and run without a pull', async () => {
  const calls = []
  const result = await pullImage('postgres', { ...quiet, run: (...args) => {
    calls.push(args); return image(ghcr)
  } })
  assert.equal(result, verifiedTag('postgres'))
  assert.deepEqual(calls, [
    ['image', 'inspect', '--platform', 'linux/amd64', ref(ghcr)],
    ['tag', ref(ghcr), verifiedTag('postgres')],
  ])
})
test('GHCR pull is pinned, must pass post-pull digest verification, and is tagged under the stable name', async () => {
  const calls = []; let pulled = false; const logs = []
  const result = await pullImage('postgres', { ...quiet, log: x => logs.push(JSON.parse(x)), run: (...args) => {
    calls.push(args)
    if (args[0] === 'pull') { pulled = true; return '' }
    if (args[0] === 'tag') return ''
    if (!pulled) return missing()
    return image(ghcr)
  } })
  assert.equal(result, verifiedTag('postgres'))
  assert.deepEqual(calls, [
    ['image', 'inspect', '--platform', 'linux/amd64', ref(ghcr)],
    ['pull', '--platform', 'linux/amd64', ref(ghcr)],
    ['image', 'inspect', '--platform', 'linux/amd64', ref(ghcr)],
    ['tag', ref(ghcr), verifiedTag('postgres')],
  ])
  assert.equal(logs[0].verifiedDigest, IMAGES.postgres.split('@')[1])
})
test('transient GHCR limit falls back to ECR with the exact same version and digest', async () => {
  const pulls = []; const waits = []; let pulled = false
  const result = await pullImage('postgres', { ...quiet, sleep: async ms => waits.push(ms), run: (...args) => {
    const target = args.at(-1)
    if (args[0] === 'pull') {
      pulls.push(target)
      if (target.startsWith(ghcr)) throw new Error('toomanyrequests: Data limit exceeded')
      pulled = true; return ''
    }
    if (!pulled) return missing()
    return image(ecr)
  } })
  assert.equal(result, verifiedTag('postgres'))
  assert.deepEqual(pulls, [ref(ghcr), ref(ghcr), ref(ghcr), ref(ecr)])
  assert.deepEqual(waits, [2000, 8000])
})
test('a transient retry can recover without switching registries', async () => {
  let attempts = 0
  const result = await pullImage('postgres', { ...quiet, run: (...args) => {
    if (args[0] === 'pull') {
      if (++attempts === 1) throw new Error('TLS handshake timeout')
      return ''
    }
    return attempts === 2 ? image(ghcr) : missing()
  } })
  assert.equal(result, verifiedTag('postgres'))
  assert.equal(attempts, 2)
})
test('both registries unavailable fails after bounded attempts', async () => {
  const pulls = []; const waits = []; const logs = []
  await assert.rejects(pullImage('postgres', { sleep: async ms => waits.push(ms), log: line => logs.push(line), run: (...args) => {
    if (args[0] !== 'pull') return missing()
    pulls.push(args.at(-1)); throw new Error('503 Service Unavailable')
  } }), /STACK_IMAGE_UNAVAILABLE/)
  assert.deepEqual(pulls, [ref(ghcr), ref(ghcr), ref(ghcr), ref(ecr), ref(ecr), ref(ecr)])
  assert.deepEqual(waits, [2000, 8000, 2000, 8000])
  assert.ok(logs.every(line => line.includes('(server_unavailable)') && !line.includes('Service Unavailable')))
})
test('rate limiting is diagnosed without logging raw registry stderr', async () => {
  const logs = []
  await assert.rejects(pullImage('postgres', { ...quiet, log: line => logs.push(line), run: (...args) => {
    if (args[0] !== 'pull') return missing()
    throw new Error('toomanyrequests: 429 token=secret-value')
  } }), /STACK_IMAGE_UNAVAILABLE/)
  assert.equal(logs.length, 6)
  assert.ok(logs.every(line => line.includes('(rate_limit)') && !line.includes('secret-value')))
})
for (const error of ['unauthorized', 'forbidden: 503', 'certificate signed by unknown authority', 'digest mismatch: timeout', 'checksum mismatch', 'unexpected digest', 'unknown Docker failure']) {
  test('security/auth/unknown errors fail closed without fallback: ' + error, async () => {
    const pulls = []
    await assert.rejects(pullImage('postgres', { ...quiet, run: (...args) => {
      if (args[0] !== 'pull') return missing()
      pulls.push(args.at(-1)); throw new Error(error)
    } }), e => e.message === error)
    assert.deepEqual(pulls, [ref(ghcr)])
  })
}
for (const overrides of [{ RepoDigests: [] }, { Id: 'mutable-tag' }, { Os: 'windows' }, { Architecture: 'unknown' }]) {
  test('invalid cached image is rejected before any pull: ' + JSON.stringify(overrides), async () => {
    const calls = []
    await assert.rejects(pullImage('postgres', { ...quiet, run: (...args) => {
      calls.push(args); return image(ghcr, overrides)
    } }), /IMAGE_INTEGRITY_FAILED/)
    assert.equal(calls.length, 1)
  })
}
test('successful pull with unexpected digest fails without fallback', async () => {
  const pulls = []
  await assert.rejects(pullImage('postgres', { ...quiet, run: (...args) => {
    if (args[0] === 'pull') { pulls.push(args.at(-1)); return '' }
    return pulls.length ? image(ghcr, { RepoDigests: [] }) : missing()
  } }), /IMAGE_INTEGRITY_FAILED/)
  assert.deepEqual(pulls, [ref(ghcr)])
})
test('daemon failure and invalid inspect JSON do not fall back', async () => {
  await assert.rejects(pullImage('postgres', { ...quiet, run: () => { throw new Error('Cannot connect to Docker daemon') } }), /Cannot connect/)
  await assert.rejects(pullImage('postgres', { ...quiet, run: () => 'invalid JSON' }), /IMAGE_INTEGRITY_FAILED/)
})
test('unknown image cannot select an unreviewed registry or version', async () => {
  await assert.rejects(pullImage('latest', { ...quiet, run: () => assert.fail('must not call docker') }), /UNKNOWN_STACK_IMAGE/)
})

test('PostgreSQL harness validates the config ID against its pinned OCI index, not equality of both digests', () => {
  const info = { Image: id, Config: { Image: id } }
  verifyLocalPostgresImage(info, { run: (...args) => {
    assert.deepEqual(args, ['image', 'inspect', id])
    return image(ghcr)
  } })
})
test('PostgreSQL harness accepts only the verified cached config ID when cache is loaded', () => {
  const previous = process.env.FINANCE_OCI_CACHE_LOADED
  process.env.FINANCE_OCI_CACHE_LOADED = '1'
  try {
    const id = VERIFIED_AMD64_IDS.postgres
    verifyLocalPostgresImage({ Image: id, Config: { Image: id } }, { run: () => JSON.stringify([{ Id: id, Os: 'linux', Architecture: 'amd64' }]) })
    assert.throws(() => verifyLocalPostgresImage({ Image: id, Config: { Image: id } }, { run: () => JSON.stringify([{ Id: id, Os: 'linux', Architecture: 'arm64' }]) }), /IMAGE_INTEGRITY_FAILED/)
  } finally {
    if (previous === undefined) delete process.env.FINANCE_OCI_CACHE_LOADED
    else process.env.FINANCE_OCI_CACHE_LOADED = previous
  }
})
test('PostgreSQL CLI keeps supporting official versioned images', () => {
  verifyLocalPostgresImage({ Config: { Image: 'ghcr.io/supabase/postgres:17.11.0.002' } }, { run: () => assert.fail('named CLI image needs no harness pull') })
})
test('PostgreSQL image validation rejects wrong indexes, mismatched config IDs and unofficial names', () => {
  const info = { Image: id, Config: { Image: id } }
  assert.throws(() => verifyLocalPostgresImage(info, { run: () => image(ghcr, { RepoDigests: [ghcr + 'postgres@sha256:' + 'b'.repeat(64)] }) }), /IMAGE_INTEGRITY_FAILED/)
  assert.throws(() => verifyLocalPostgresImage(info, { run: () => image(ghcr, { Id: 'sha256:' + 'b'.repeat(64) }) }), /IMAGE_INTEGRITY_FAILED/)
  assert.throws(() => verifyLocalPostgresImage({ Config: { Image: 'evil.invalid/supabase/postgres:17.6.1.166' } }), /IMAGE_INTEGRITY_FAILED/)
})
