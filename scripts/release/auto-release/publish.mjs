import { decodeMarker, encodeMarker, requireFact, ReleaseError } from './core.mjs'
import { prepareRelease } from './plan.mjs'
import { optional } from './http.mjs'

export async function publishRelease(config, services, options = {}) {
  requireFact(!(options.publish && options.mode === 'dry-run'), 'DRY_RUN_CANNOT_PUBLISH')
  const { github } = services
  const plan = await prepareRelease(config, services, options)
  if (plan.action === 'noop' || !options.publish)
    return { ...plan, dryRun: !options.publish, writes: 0 }
  requireFact(options.enabled === true, 'PUBLICATION_DISABLED')
  const proof = {
    schema: 1,
    initialization: plan.initialization,
    repository: config.repository,
    version: plan.version,
    sha: plan.sha,
    planHash: plan.planHash,
  }
  const tagPath = `${github.base}/git/refs`
  // Everything is re-read immediately before EACH externally visible write.
  const recheck = async () => {
    const now = await prepareRelease(config, services, options)
    if (now.action === 'noop') {
      requireFact(now.sha === plan.sha && now.version === plan.version, 'PUBLICATION_STATE_CHANGED')
      return false
    }
    requireFact(
      now.sha === plan.sha &&
        now.deploymentId === plan.deploymentId &&
        now.version === plan.version &&
        now.planHash === plan.planHash,
      'PRODUCTION_OR_RELEASE_PLAN_CHANGED'
    )
    return true
  }
  const verifyTag = (tag) => {
    requireFact(tag?.sha === plan.sha, 'TAG_CONFLICT')
    if (!tag.message && plan.initialization) return // Explicitly approved existing baseline tag, same SHA.
    const marker = decodeMarker(tag.message)
    requireFact(
      marker.planHash === plan.planHash &&
        marker.sha === plan.sha &&
        marker.version === plan.version &&
        marker.repository === config.repository,
      'TAG_PLAN_CONFLICT'
    )
  }
  let tag = await github.tag(plan.version),
    writes = 0
  const adoptedExistingTag = !!tag && !tag.message && plan.initialization
  if (tag) verifyTag(tag)
  else {
    if (!(await recheck()))
      return { ...plan, action: 'noop', reason: 'CONCURRENT_PUBLICATION', writes }
    const object = await github.api(`${github.base}/git/tags`, 'POST', {
      tag: plan.version,
      message: encodeMarker(proof),
      object: plan.sha,
      type: 'commit',
    })
    writes++
    if (!(await recheck()))
      return { ...plan, action: 'noop', reason: 'CONCURRENT_PUBLICATION', writes }
    try {
      await github.api(tagPath, 'POST', { ref: `refs/tags/${plan.version}`, sha: object.sha })
      writes++
    } catch (error) {
      tag = await github.tag(plan.version)
      if (!tag) throw error
      verifyTag(tag)
    }
    verifyTag(await github.tag(plan.version))
  }
  if (!(await recheck()))
    return { ...plan, action: 'noop', reason: 'CONCURRENT_PUBLICATION', writes }
  verifyTag(await github.tag(plan.version))
  let release
  try {
    release = await github.api(`${github.base}/releases`, 'POST', {
      tag_name: plan.version,
      target_commitish: plan.sha,
      name: `Evolutus ${plan.version}`,
      body: `${plan.notes}\n<!-- ${encodeMarker({ ...proof, adoptedExistingTag, deploymentId: plan.deploymentId, ciRunId: plan.ciRunId, officialNotesHash: plan.officialNotesHash })} -->`,
      draft: false,
      prerelease: false,
      make_latest: 'true',
    })
    writes++
  } catch (error) {
    // Lost responses and concurrent retries recover by reading, never by replacing a Release.
    release = await optional(() => github.api(`${github.base}/releases/tags/${plan.version}`))
    if (!release) throw error
  }
  const released = decodeMarker(release.body)
  requireFact(
    !release.draft &&
      !release.prerelease &&
      release.tag_name === plan.version &&
      released.planHash === plan.planHash &&
      released.sha === plan.sha,
    'RELEASE_CONFLICT'
  )
  verifyTag(await github.tag(plan.version))
  // A rollback racing AFTER creation is reported; published history is never deleted.
  try {
    const after = await prepareRelease(config, services, { ...options, mode: 'auto' })
    requireFact(
      after.sha === plan.sha && after.deploymentId === plan.deploymentId,
      'POST_PUBLICATION_DRIFT'
    )
  } catch {
    throw new ReleaseError('POST_PUBLICATION_DRIFT_AUDIT_REQUIRED')
  }
  return { ...plan, action: 'published', releaseId: release.id, dryRun: false, writes }
}
