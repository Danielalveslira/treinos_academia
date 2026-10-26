import { randomUUID } from 'node:crypto'
import { requireFact, validDeployment, validSha } from './core.mjs'

export function checkRollback(project, deployment) {
  const r = project.lastAliasRequest
  if (!r) {
    requireFact(
      !project.rollbackDescription && !project.lastRollbackTarget,
      'ROLLBACK_STATE_UNCERTAIN'
    )
    return
  }
  requireFact(['promote', 'rollback'].includes(r.type), 'UNKNOWN_ALIAS_OPERATION')
  requireFact(r.jobStatus === 'succeeded', 'ALIAS_OPERATION_NOT_SETTLED')
  if (r.type === 'rollback') {
    requireFact(r.toDeploymentId !== deployment.id, 'ROLLBACK_ACTIVE')
    requireFact(
      Number.isFinite(r.requestedAt) && deployment.createdAt > r.requestedAt,
      'ROLLBACK_STATE_UNCERTAIN'
    )
  }
}
export async function detectProduction(config, vercel, readPublic, event = {}) {
  requireFact(event.name !== 'pull_request', 'PREVIEW_EVENT')
  let hintedId
  if (event.name === 'repository_dispatch') {
    requireFact(
      ['vercel.deployment.success', 'vercel.deployment.promoted'].includes(event.action),
      'UNSUPPORTED_DISPATCH'
    )
    const p = event.client_payload
    requireFact(p?.environment === 'production', 'PREVIEW_EVENT')
    requireFact(validDeployment(p.id), 'INVALID_DEPLOYMENT_ID')
    requireFact(p.project?.id === config.vercelProjectId, 'EVENT_PROJECT_MISMATCH')
    hintedId = p.id
  }
  const query = `?teamId=${encodeURIComponent(config.vercelTeamId)}`
  const project = await vercel(`/v9/projects/${config.vercelProjectId}${query}`)
  const [owner, repo] = config.repository.split('/')
  requireFact(
    project.id === config.vercelProjectId &&
      (!project.accountId || project.accountId === config.vercelTeamId),
    'PROJECT_MISMATCH'
  )
  requireFact(
    project.link?.type === 'github' &&
      project.link.repoId === config.repositoryId &&
      project.link.org === owner &&
      project.link.repo === repo &&
      project.link.productionBranch === config.branch,
    'PROJECT_REPOSITORY_MISMATCH'
  )
  requireFact(!project.paused, 'PROJECT_PAUSED')
  const alias = await vercel(`/v4/aliases/${config.productionDomain}${query}`)
  requireFact(
    alias.alias === config.productionDomain &&
      alias.projectId === config.vercelProjectId &&
      validDeployment(alias.deploymentId),
    'DOMAIN_PROJECT_MISMATCH'
  )
  const deployment = await vercel(`/v13/deployments/${hintedId || alias.deploymentId}${query}`)
  requireFact(deployment.id === (hintedId || alias.deploymentId), 'DEPLOYMENT_ID_MISMATCH')
  requireFact(
    deployment.projectId === config.vercelProjectId && deployment.ownerId === config.vercelTeamId,
    'DEPLOYMENT_PROJECT_MISMATCH'
  )
  requireFact(deployment.target === 'production', 'PREVIEW_DEPLOYMENT')
  requireFact(
    deployment.readyState === 'READY' && deployment.aliasAssigned === true,
    'DEPLOYMENT_NOT_READY'
  )
  requireFact(
    deployment.id === alias.deploymentId && project.targets?.production?.id === deployment.id,
    'DEPLOYMENT_NOT_ACTIVE'
  )
  const source = deployment.gitSource
  requireFact(
    source?.type === 'github' && source.repoId === config.repositoryId && validSha(source.sha),
    'UNPROVEN_GIT_SOURCE'
  )
  requireFact(
    source.ref === config.branch || source.ref === source.sha,
    'DEPLOYMENT_BRANCH_MISMATCH'
  )
  requireFact(
    !deployment.meta?.githubCommitSha || deployment.meta.githubCommitSha === source.sha,
    'GIT_METADATA_CONFLICT'
  )
  requireFact(
    !deployment.meta?.githubCommitOrg || deployment.meta.githubCommitOrg === owner,
    'GIT_REPOSITORY_METADATA_CONFLICT'
  )
  requireFact(
    !deployment.meta?.githubCommitRepo || deployment.meta.githubCommitRepo === repo,
    'GIT_REPOSITORY_METADATA_CONFLICT'
  )
  if (event.name === 'repository_dispatch' && event.client_payload.git?.sha)
    requireFact(event.client_payload.git.sha === source.sha, 'EVENT_COMMIT_MISMATCH')
  checkRollback(project, deployment)
  const domain = await vercel(
    `/v9/projects/${config.vercelProjectId}/domains/${config.productionDomain}${query}`
  )
  requireFact(
    domain.name === config.productionDomain && domain.verified === true && !domain.redirect,
    'DOMAIN_NOT_VERIFIED'
  )
  const identity = await readPublic(`https://${config.productionDomain}${config.identityPath}`)
  requireFact(
    identity.schema === 1 &&
      identity.repository === config.repository &&
      identity.commit === source.sha &&
      identity.deploymentId === deployment.id &&
      identity.projectId === config.vercelProjectId,
    'PUBLIC_IDENTITY_MISMATCH'
  )
  if (event.name === 'workflow_run')
    requireFact(
      event.workflow_run?.head_sha === source.sha &&
        event.workflow_run?.head_branch === config.branch &&
        event.workflow_run?.head_repository?.id === config.repositoryId,
      'STALE_CI_EVENT'
    )
  return { sha: source.sha, deploymentId: deployment.id }
}
export function publicReader(fetchImpl = fetch) {
  return async (url) => {
    const response = await fetchImpl(`${url}?verify=${randomUUID()}`, {
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: { 'Cache-Control': 'no-cache' },
    })
    requireFact(
      response.status === 200 && response.headers.get('content-type')?.includes('application/json'),
      'PUBLIC_IDENTITY_UNAVAILABLE'
    )
    const text = await response.text()
    requireFact(text.length < 16384, 'PUBLIC_IDENTITY_TOO_LARGE')
    try {
      return JSON.parse(text)
    } catch {
      requireFact(false, 'PUBLIC_IDENTITY_INVALID_JSON')
    }
  }
}
