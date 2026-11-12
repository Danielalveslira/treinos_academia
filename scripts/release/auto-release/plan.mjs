import {
  requireFact,
  validSha,
  versionParts,
  compareVersions,
  nextVersion,
  publicChanges,
  formatNotes,
  digest,
  decodeMarker,
  validateConfig,
} from './core.mjs'
import { detectProduction } from './production.mjs'

export async function prepareRelease(config, services, options = {}) {
  validateConfig(config)
  const { github, vercel, readPublic } = services
  const production = await detectProduction(config, vercel, readPublic, options.event)
  const current = await github.assertMain(production.sha)
  const ciRunId = await github.verifyCI(production.sha)
  const history = await github.officialReleases()
  const previous = history.official.at(-1)
  const same = history.official.find((r) => r.sha === production.sha)
  if (same)
    return {
      action: 'noop',
      reason:
        same.version === previous?.version
          ? 'COMMIT_ALREADY_RELEASED'
          : 'ROLLBACK_TO_PUBLISHED_VERSION',
      version: same.version,
      ...production,
    }
  let version,
    changes = [],
    initialization = false
  if (!previous) {
    requireFact(
      history.all.every((r) => r.draft),
      'EXISTING_RELEASES_REQUIRE_AUDIT'
    )
    requireFact(options.mode === 'initialize', 'EXPLICIT_BASELINE_REQUIRED')
    requireFact(
      validSha(options.baselineSha) && options.baselineSha === production.sha,
      'BASELINE_NOT_CURRENT_PRODUCTION'
    )
    versionParts(options.baselineVersion)
    const tags = await github.api(`${github.base}/tags?per_page=100`)
    // More than one page is deliberately not silently ignored during initialization.
    requireFact(tags.length < 100, 'BASELINE_TAG_AUDIT_REQUIRED')
    for (const tag of tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t.name))) {
      requireFact(
        compareVersions(tag.name, options.baselineVersion) <= 0,
        'BASELINE_BELOW_EXISTING_TAG'
      )
    }
    version = options.baselineVersion
    initialization = true
  } else {
    requireFact(options.mode !== 'initialize', 'ALREADY_INITIALIZED')
    const diff = await github.compare(previous.sha, production.sha)
    requireFact(['ahead', 'identical'].includes(diff.status), 'ROLLBACK_OR_DIVERGED_HISTORY')
    const old = await github.commit(previous.sha)
    if (old.commit.tree.sha === current.commit.tree.sha)
      return {
        action: 'noop',
        reason: 'IDENTICAL_PUBLISHED_TREE',
        version: previous.version,
        ...production,
      }
    changes = await github.changes(previous.sha, production.sha)
    requireFact(changes.length > 0, 'EMPTY_CHANGE_RANGE')
    if (!publicChanges(changes).length)
      return { action: 'noop', reason: 'NO_PUBLIC_CHANGES', ...production }
    version = nextVersion(previous.version, changes)
  }
  const plan = {
    action: 'publish',
    schema: 1,
    repository: config.repository,
    ...production,
    ciRunId,
    version,
    initialization,
    previous: previous ? { id: previous.id, sha: previous.sha, version: previous.version } : null,
  }
  plan.notes = formatNotes(config, plan, changes)
  // Deployment and run IDs do not change version identity during a simple redeploy.
  plan.planHash = digest({
    repository: config.repository,
    projectId: config.vercelProjectId,
    domain: config.productionDomain,
    sha: plan.sha,
    version,
    previous: plan.previous,
    initialization,
    changes: changes.map((c) => ({
      number: c.number,
      sha: c.sha,
      title: c.title,
      note: c.body?.match(/^Nota de vers[aã]o:\s*(.+)$/im)?.[1],
      labels: [...c.labels].sort(),
    })),
  })
  // GitHub requires contents:write for generate-notes despite its non-persistent
  // response. The read-only verification/dry-run uses our deterministic notes.
  plan.officialNotesStatus = initialization ? 'not-applicable' : 'deferred-until-publication'
  if (!initialization && options.publish) {
    const generated = await github.officialNotes(version, plan.sha, previous.version)
    requireFact(typeof generated.body === 'string', 'OFFICIAL_NOTES_UNAVAILABLE')
    const references = [
      ...generated.body.matchAll(
        new RegExp(`https://github\\.com/${config.repository}/pull/(\\d+)`, 'g')
      ),
    ].map((m) => Number(m[1]))
    const directPulls = new Set(changes.map((c) => c.number).filter(Boolean))
    for (const number of new Set(references))
      if (!directPulls.has(number))
        requireFact(
          await github.pullMergedInRange(number, previous.sha, plan.sha),
          'OFFICIAL_NOTES_RANGE_MISMATCH'
        )
    plan.officialNotesHash = digest(generated.body)
    plan.officialNotesStatus = 'verified'
  }
  const existing = await github.tag(version)
  if (existing) {
    requireFact(existing.sha === plan.sha, 'TAG_CONFLICT')
    if (existing.message || !initialization) {
      const record = decodeMarker(existing.message)
      requireFact(
        record.planHash === plan.planHash &&
          record.sha === plan.sha &&
          record.repository === config.repository &&
          record.version === plan.version,
        'TAG_PLAN_CONFLICT'
      )
    }
  }
  requireFact(!history.all.some((r) => r.tag_name === version), 'EXISTING_RELEASE_CONFLICT')
  return plan
}
