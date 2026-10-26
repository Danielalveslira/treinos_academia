import { readFile, writeFile, appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import config from './auto-release/config.json' with { type: 'json' }
import { createApi } from './auto-release/http.mjs'
import { githubRepository } from './auto-release/github.mjs'
import { publicReader } from './auto-release/production.mjs'
import { publishRelease } from './auto-release/publish.mjs'
import { requireFact } from './auto-release/core.mjs'

export async function main(args = process.argv.slice(2), env = process.env) {
  requireFact(
    args.every((a) => ['--publish'].includes(a)),
    'INVALID_ARGUMENT'
  )
  const publish = args.includes('--publish')
  requireFact(!(publish && env.RELEASE_MODE === 'dry-run'), 'DRY_RUN_CANNOT_PUBLISH')
  requireFact(!publish || env.EVOLUTUS_AUTO_RELEASE_ENABLED === 'true', 'PUBLICATION_DISABLED')
  requireFact(
    !publish ||
      (env.GITHUB_ACTIONS === 'true' &&
        env.GITHUB_WORKFLOW_REF ===
          `${config.repository}/.github/workflows/auto-release.yml@refs/heads/main`),
    'PUBLICATION_REQUIRES_TRUSTED_WORKFLOW'
  )
  requireFact(
    !env.GITHUB_REPOSITORY || env.GITHUB_REPOSITORY === config.repository,
    'WORKFLOW_REPOSITORY_MISMATCH'
  )
  requireFact(!env.GITHUB_REF || env.GITHUB_REF === 'refs/heads/main', 'WORKFLOW_NOT_ON_MAIN')
  requireFact(env.GITHUB_TOKEN && env.VERCEL_RELEASE_READ_TOKEN, 'MISSING_CREDENTIALS')
  requireFact(
    ['auto', 'dry-run', 'initialize'].includes(env.RELEASE_MODE || 'auto'),
    'INVALID_MODE'
  )
  const event = env.GITHUB_EVENT_PATH
    ? JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'))
    : {}
  event.name = env.GITHUB_EVENT_NAME || 'workflow_dispatch'
  requireFact(
    ['workflow_dispatch', 'workflow_run', 'repository_dispatch', 'schedule'].includes(event.name),
    'UNSUPPORTED_EVENT'
  )
  const gh = createApi('https://api.github.com', env.GITHUB_TOKEN, {
    writable: publish,
    repository: config.repository,
  })
  const services = {
    github: githubRepository(config, gh),
    vercel: createApi('https://api.vercel.com', env.VERCEL_RELEASE_READ_TOKEN),
    readPublic: publicReader(),
  }
  const result = await publishRelease(config, services, {
    event,
    publish,
    enabled: env.EVOLUTUS_AUTO_RELEASE_ENABLED === 'true',
    mode: env.RELEASE_MODE || 'auto',
    baselineSha: env.RELEASE_BASELINE_SHA,
    baselineVersion: env.RELEASE_BASELINE_VERSION,
  })
  const safe = { ...result }
  if (env.RELEASE_REPORT_PATH)
    await writeFile(env.RELEASE_REPORT_PATH, JSON.stringify(safe, null, 2) + '\n')
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `action=${result.action}\n`)
  if (env.GITHUB_STEP_SUMMARY)
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `Resultado: **${result.action}**\n\n${result.notes || result.reason}\n\nGerador oficial: ${result.officialNotesStatus || 'not-applicable'}.\n`
    )
  console.log(
    JSON.stringify({
      action: result.action,
      reason: result.reason,
      sha: result.sha,
      version: result.version,
      deploymentId: result.deploymentId,
      dryRun: result.dryRun,
      writes: result.writes,
      officialNotesStatus: result.officialNotesStatus,
    })
  )
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ action: 'blocked', code: error.code || 'UNEXPECTED_ERROR' }))
    process.exitCode = 1
  })
}
