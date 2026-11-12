import { requireFact, validSha, decodeMarker, compareVersions } from './core.mjs'
import { optional, pages } from './http.mjs'

export function githubRepository(config, api) {
  const base = `/repos/${config.repository}`
  async function commit(sha) {
    requireFact(validSha(sha), 'INVALID_GIT_SHA')
    const c = await api(`${base}/commits/${sha}`)
    requireFact(c.sha === sha && validSha(c.commit?.tree?.sha), 'INVALID_COMMIT_RESPONSE')
    return c
  }
  async function compare(from, to) {
    requireFact(validSha(from) && validSha(to), 'INVALID_GIT_SHA')
    return api(`${base}/compare/${from}...${to}?per_page=100&page=1`)
  }
  async function assertMain(sha) {
    const repo = await api(base)
    requireFact(
      repo.id === config.repositoryId &&
        repo.default_branch === config.branch &&
        repo.full_name === config.repository,
      'REPOSITORY_MISMATCH'
    )
    const head = await api(`${base}/commits/${config.branch}`)
    const ancestry = await compare(sha, head.sha)
    requireFact(['ahead', 'identical'].includes(ancestry.status), 'COMMIT_NOT_IN_MAIN')
    return commit(sha)
  }
  async function verifyCI(sha) {
    const workflow = await api(`${base}/actions/workflows/${config.workflow}`)
    requireFact(
      workflow.path === `.github/workflows/${config.workflow}` && workflow.state === 'active',
      'CI_WORKFLOW_MISMATCH'
    )
    const runs = await pages(
      api,
      `${base}/actions/workflows/${workflow.id}/runs?head_sha=${sha}&branch=${config.branch}`,
      'workflow_runs'
    )
    const matches = runs
      .filter(
        (r) =>
          r.head_sha === sha &&
          r.head_branch === config.branch &&
          ['push', 'workflow_dispatch'].includes(r.event) &&
          r.repository?.id === config.repositoryId &&
          r.head_repository?.id === config.repositoryId
      )
      .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)
    requireFact(matches.length, 'MAIN_CI_MISSING')
    const run = matches[0]
    requireFact(run.status === 'completed', 'CI_PENDING')
    requireFact(run.conclusion === 'success', 'CI_FAILED')
    const jobs = await pages(
      api,
      `${base}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
      'jobs'
    )
    requireFact(
      jobs.every((j) => j.status === 'completed' && ['success', 'skipped'].includes(j.conclusion)),
      'CI_HAS_UNAPPROVED_JOBS'
    )
    for (const name of config.requiredJobs) {
      const found = jobs.filter((j) => j.name === name)
      requireFact(
        found.length === 1 && found[0].status === 'completed' && found[0].conclusion === 'success',
        'MANDATORY_JOB_NOT_APPROVED'
      )
    }
    return run.id
  }
  async function tag(version) {
    const ref = await optional(() => api(`${base}/git/ref/tags/${encodeURIComponent(version)}`))
    if (!ref) return null
    let object = ref.object,
      message = null
    for (let i = 0; object.type === 'tag' && i < 5; i++) {
      const t = await api(`${base}/git/tags/${object.sha}`)
      message ??= t.message
      object = t.object
    }
    requireFact(object.type === 'commit' && validSha(object.sha), 'INVALID_TAG_TARGET')
    return { sha: object.sha, message }
  }
  async function officialReleases() {
    const all = await pages(api, `${base}/releases`)
    const official = []
    for (const r of all) {
      if (r.draft || r.prerelease || !/^v\d+\.\d+\.\d+$/.test(r.tag_name)) continue
      const proof = decodeMarker(r.body)
      requireFact(
        proof.repository === config.repository && proof.version === r.tag_name,
        'RELEASE_PROOF_MISMATCH'
      )
      const t = await tag(r.tag_name)
      requireFact(t?.sha === proof.sha, 'PUBLISHED_TAG_CHANGED')
      if (t.message) {
        const tagProof = decodeMarker(t.message)
        requireFact(
          tagProof.planHash === proof.planHash &&
            tagProof.repository === config.repository &&
            tagProof.version === proof.version &&
            tagProof.sha === proof.sha,
          'PUBLISHED_TAG_PROOF_CHANGED'
        )
      } else requireFact(proof.initialization && proof.adoptedExistingTag, 'UNPROVEN_PUBLISHED_TAG')
      official.push({ ...proof, id: r.id })
    }
    official.sort((a, b) => compareVersions(a.version, b.version))
    return { official, all }
  }
  async function changes(from, to) {
    const first = await compare(from, to)
    requireFact(['ahead', 'identical'].includes(first.status), 'ROLLBACK_OR_DIVERGED_HISTORY')
    requireFact(first.total_commits <= 500, 'CHANGE_RANGE_TOO_LARGE')
    const commits = [...first.commits]
    for (let page = 2; commits.length < first.total_commits; page++) {
      requireFact(page <= 5, 'INCOMPLETE_CHANGE_RANGE')
      const part = await api(`${base}/compare/${from}...${to}?per_page=100&page=${page}`)
      requireFact(part.commits?.length, 'INCOMPLETE_CHANGE_RANGE')
      commits.push(...part.commits)
    }
    requireFact(commits.length === first.total_commits, 'INCOMPLETE_CHANGE_RANGE')
    const shaSet = new Set(commits.map((c) => c.sha)),
      prs = new Map(),
      covered = new Set()
    const [owner, name] = config.repository.split('/')
    for (let start = 0; start < commits.length; start += 20) {
      const batch = commits.slice(start, start + 20)
      batch.forEach((c) => requireFact(validSha(c.sha), 'INVALID_GIT_SHA'))
      const fields = batch
        .map(
          (c, i) =>
            `c${i}:object(oid:"${c.sha}"){... on Commit{associatedPullRequests(first:20){pageInfo{hasNextPage} nodes{number title body mergedAt baseRefName mergeCommit{oid} labels(first:50){pageInfo{hasNextPage} nodes{name}}}}}}`
        )
        .join(' ')
      const result = await api('/graphql', 'POST', {
        query: `query{repository(owner:"${owner}",name:"${name}"){${fields}}}`,
      })
      requireFact(!result.errors && result.data?.repository, 'CHANGE_QUERY_FAILED')
      batch.forEach((c, i) => {
        const association = result.data.repository[`c${i}`]?.associatedPullRequests
        requireFact(association && !association.pageInfo.hasNextPage, 'INCOMPLETE_PR_ASSOCIATIONS')
        for (const p of association.nodes) {
          if (!p.mergedAt || p.baseRefName !== config.branch || !shaSet.has(p.mergeCommit?.oid))
            continue
          requireFact(
            Number.isSafeInteger(p.number) && p.number > 0 && !p.labels.pageInfo.hasNextPage,
            'INCOMPLETE_PR_METADATA'
          )
          requireFact(p.body.length <= 70000 && p.title.length <= 1000, 'PR_METADATA_TOO_LARGE')
          prs.set(p.number, {
            number: p.number,
            title: p.title,
            body: p.body,
            labels: p.labels.nodes.map((l) => l.name),
          })
          covered.add(c.sha)
        }
      })
    }
    const direct = commits
      .filter((c) => !covered.has(c.sha))
      .map((c) => ({
        sha: c.sha,
        title: c.commit.message.split('\n')[0],
        body: c.commit.message,
        labels: [],
      }))
    return [...[...prs.values()].sort((a, b) => a.number - b.number), ...direct]
  }
  async function officialNotes(version, sha, previous) {
    return api(`${base}/releases/generate-notes`, 'POST', {
      tag_name: version,
      target_commitish: sha,
      previous_tag_name: previous,
      configuration_file_path: '.github/release.yml',
    })
  }
  async function pullMergedInRange(number, from, to) {
    const pull = await optional(() => api(`${base}/pulls/${number}`))
    if (
      !pull ||
      pull.number !== number ||
      !pull.merged_at ||
      pull.base?.repo?.full_name !== config.repository ||
      !validSha(pull.merge_commit_sha)
    ) return false
    const [before, after] = await Promise.all([
      compare(from, pull.merge_commit_sha),
      compare(pull.merge_commit_sha, to),
    ])
    return before.status === 'ahead' && ['ahead', 'identical'].includes(after.status)
  }
  return {
    base,
    api,
    commit,
    compare,
    assertMain,
    verifyCI,
    tag,
    officialReleases,
    changes,
    officialNotes,
    pullMergedInRange,
  }
}
