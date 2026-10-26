import config from './auto-release/config.json' with { type: 'json' }
import { validSha, validDeployment } from './auto-release/core.mjs'

export function buildIdentity(env = process.env) {
  return {
    schema: 1,
    repository: config.repository,
    commit: validSha(env.VERCEL_GIT_COMMIT_SHA) ? env.VERCEL_GIT_COMMIT_SHA : null,
    deploymentId: validDeployment(env.VERCEL_DEPLOYMENT_ID) ? env.VERCEL_DEPLOYMENT_ID : null,
    projectId: env.VERCEL_PROJECT_ID === config.vercelProjectId ? env.VERCEL_PROJECT_ID : null,
  }
}
export function buildIdentityPlugin() {
  return {
    name: 'evolutus-build-identity',
    apply: 'build',
    enforce: 'post',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: config.identityPath.slice(1),
        source: JSON.stringify(buildIdentity()) + '\n',
      })
    },
  }
}
