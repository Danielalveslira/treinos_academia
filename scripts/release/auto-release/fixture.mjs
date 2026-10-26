// In-memory official-API simulator. Never constructs a network client or reads credentials.
import targetConfig from './config.json' with { type: 'json' }
import { encodeMarker, digest, ReleaseError } from './core.mjs'
import { githubRepository } from './github.mjs'
import { ApiError } from './http.mjs'

const config = {
  ...targetConfig,
  repository: 'example/evolutus-fixture',
  repositoryId: 12345,
  vercelProjectId: 'prj_syntheticProject',
  vercelTeamId: 'team_synthetic',
  productionDomain: 'evolutus.example',
}
export const SHA_A = 'a'.repeat(40),
  SHA_B = 'b'.repeat(40),
  SHA_C = 'c'.repeat(40)
export const DEFAULT_DEPLOYMENT = 'dpl_syntheticProduction'
export function fixture({ initialized = true } = {}) {
  const state = {
    writes: [],
    calls: [],
    releases: [],
    tags: new Map(),
    objects: new Map(),
    mainSha: SHA_B,
    treeA: '1'.repeat(40),
    treeB: '2'.repeat(40),
    commits: [
      { sha: SHA_C, commit: { message: 'fix: corrigir ficha' } },
      { sha: SHA_B, commit: { message: 'Merge pull request #80' } },
    ],
    prs: [
      {
        number: 80,
        title: 'fix: corrigir ficha',
        body: 'Nota de versão: Corrigimos o registro de fichas.',
        mergedAt: '2026-10-26T10:00:00Z',
        baseRefName: 'main',
        mergeCommit: { oid: SHA_B },
        labels: { pageInfo: { hasNextPage: false }, nodes: [{ name: 'semver:patch' }] },
      },
    ],
    project: {
      id: config.vercelProjectId,
      accountId: config.vercelTeamId,
      link: {
        type: 'github',
        repoId: config.repositoryId,
        org: 'example',
        repo: 'evolutus-fixture',
        productionBranch: 'main',
      },
      targets: { production: { id: DEFAULT_DEPLOYMENT } },
      lastAliasRequest: null,
      lastRollbackTarget: null,
    },
    deployment: {
      id: DEFAULT_DEPLOYMENT,
      ownerId: config.vercelTeamId,
      projectId: config.vercelProjectId,
      target: 'production',
      readyState: 'READY',
      aliasAssigned: true,
      createdAt: 200,
      source: 'git',
      gitSource: { type: 'github', repoId: config.repositoryId, ref: 'main', sha: SHA_B },
    },
    alias: {
      alias: config.productionDomain,
      projectId: config.vercelProjectId,
      deploymentId: DEFAULT_DEPLOYMENT,
    },
    domain: { name: config.productionDomain, verified: true, redirect: null },
    identity: {
      schema: 1,
      repository: config.repository,
      commit: SHA_B,
      deploymentId: DEFAULT_DEPLOYMENT,
      projectId: config.vercelProjectId,
    },
    run: {
      id: 901,
      run_number: 10,
      run_attempt: 1,
      head_sha: SHA_B,
      head_branch: 'main',
      repository: { id: config.repositoryId },
      head_repository: { id: config.repositoryId },
      event: 'push',
      status: 'completed',
      conclusion: 'success',
    },
    jobs: config.requiredJobs.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
    notesBody: `## Correções\n- Corrigir ficha https://github.com/${config.repository}/pull/80`,
  }
  const copy = (v) => structuredClone(v)
  const base = `/repos/${config.repository}`
  const putTag = (version, sha, message) => {
    if (!message) state.tags.set(version, { object: { type: 'commit', sha } })
    else {
      const id = digest({ version, sha, message }).slice(0, 40)
      state.objects.set(id, { object: { type: 'commit', sha }, message })
      state.tags.set(version, { object: { type: 'tag', sha: id } })
    }
  }
  if (initialized) {
    const proof = {
      schema: 1,
      repository: config.repository,
      version: 'v1.0.0',
      sha: SHA_A,
      planHash: '0'.repeat(64),
      initialization: true,
    }
    putTag(proof.version, proof.sha, encodeMarker(proof))
    state.releases.push({
      id: 1,
      tag_name: proof.version,
      body: encodeMarker(proof),
      draft: false,
      prerelease: false,
    })
  }
  const gh = async (path, method = 'GET', body) => {
    state.calls.push({ platform: 'github', path, method })
    if (state.intercept) {
      const r = await state.intercept(path, method, body)
      if (r !== undefined) return copy(r)
    }
    const route = path.split('?')[0]
    if (method === 'GET') {
      if (route === base)
        return { id: config.repositoryId, default_branch: 'main', full_name: config.repository }
      if (route === `${base}/releases`) return copy(state.releases)
      if (route === `${base}/tags`)
        return [...state.tags].map(([name, ref]) => ({ name, commit: ref.object }))
      if (route.startsWith(`${base}/releases/tags/`)) {
        const r = state.releases.find(
          (r) => r.tag_name === decodeURIComponent(route.split('/').at(-1))
        )
        if (!r) throw new ApiError(404)
        return copy(r)
      }
      if (route.startsWith(`${base}/git/ref/tags/`)) {
        const t = state.tags.get(decodeURIComponent(route.split('/').at(-1)))
        if (!t) throw new ApiError(404)
        return copy(t)
      }
      if (route.startsWith(`${base}/git/tags/`)) {
        const t = state.objects.get(route.split('/').at(-1))
        if (!t) throw new ApiError(404)
        return copy(t)
      }
      if (route.startsWith(`${base}/commits/`)) {
        const sha = route.split('/').at(-1) === 'main' ? state.mainSha : route.split('/').at(-1)
        return { sha, commit: { tree: { sha: sha === SHA_A ? state.treeA : state.treeB } } }
      }
      if (route.startsWith(`${base}/compare/`)) {
        const [from, to] = route.split('/').at(-1).split('...')
        const commits = from === to ? [] : state.commits
        const page = Number(new URL('https://fixture' + path).searchParams.get('page') || 1)
        return {
          status: from === to ? 'identical' : 'ahead',
          total_commits: commits.length,
          commits: copy(commits.slice((page - 1) * 100, page * 100)),
        }
      }
      if (route === `${base}/actions/workflows/${config.workflow}`)
        return { id: 9, path: `.github/workflows/${config.workflow}`, state: 'active' }
      if (route === `${base}/actions/workflows/9/runs`) return { workflow_runs: [copy(state.run)] }
      if (route === `${base}/actions/runs/901/attempts/1/jobs`) return { jobs: copy(state.jobs) }
    }
    if (method === 'POST' && route === '/graphql') {
      const repo = {}
      for (const m of body.query.matchAll(/c(\d+):object\(oid:"([a-f0-9]{40})"\)/g))
        repo[`c${m[1]}`] = {
          associatedPullRequests: { pageInfo: { hasNextPage: false }, nodes: copy(state.prs) },
        }
      return { data: { repository: repo } }
    }
    if (method === 'POST' && route === `${base}/releases/generate-notes`)
      return { body: state.notesBody }
    if (method === 'POST') {
      if (state.beforeWrite) await state.beforeWrite(route, body)
      if (route === `${base}/git/tags`) {
        const id = digest(body).slice(0, 40)
        state.objects.set(id, {
          message: body.message,
          object: { type: 'commit', sha: body.object },
        })
        state.writes.push(route)
        if (state.loseTagObjectResponse) {
          state.loseTagObjectResponse = false
          throw new ReleaseError('API_NETWORK_ERROR')
        }
        return { sha: id }
      }
      if (route === `${base}/git/refs`) {
        const version = body.ref.slice('refs/tags/'.length)
        if (state.tags.has(version)) throw new ApiError(422)
        state.tags.set(version, { object: { type: 'tag', sha: body.sha } })
        state.writes.push(route)
        if (state.loseRefResponse) {
          state.loseRefResponse = false
          throw new ReleaseError('API_NETWORK_ERROR')
        }
        return copy(state.tags.get(version))
      }
      if (route === `${base}/releases`) {
        if (state.releases.some((r) => r.tag_name === body.tag_name)) throw new ApiError(422)
        const r = { ...body, id: state.releases.length + 1 }
        state.releases.push(r)
        state.writes.push(route)
        if (state.loseReleaseResponse) {
          state.loseReleaseResponse = false
          throw new ReleaseError('API_NETWORK_ERROR')
        }
        return copy(r)
      }
    }
    throw new Error(`Unexpected fixture route: ${method} ${path}`)
  }
  const vercel = async (path, method = 'GET') => {
    state.calls.push({ platform: 'vercel', path, method })
    if (state.vercelError) throw new ReleaseError('API_NETWORK_ERROR')
    if (path.startsWith('/v4/aliases/')) return copy(state.alias)
    if (path.startsWith('/v13/deployments/')) return copy(state.deployment)
    if (path.includes('/domains/')) return copy(state.domain)
    return copy(state.project)
  }
  const readPublic = async () => {
    if (state.publicError) throw new ReleaseError('PUBLIC_IDENTITY_UNAVAILABLE')
    return copy(state.identity)
  }
  return {
    config,
    state,
    putTag,
    services: { github: githubRepository(config, gh), vercel, readPublic },
  }
}
