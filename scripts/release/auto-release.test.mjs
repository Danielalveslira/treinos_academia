import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fixture, SHA_A, SHA_B, SHA_C, DEFAULT_DEPLOYMENT } from './auto-release/fixture.mjs'
import { publishRelease } from './auto-release/publish.mjs'
import { prepareRelease } from './auto-release/plan.mjs'
import {
  classify,
  nextVersion,
  versionParts,
  safeText,
  encodeMarker,
} from './auto-release/core.mjs'
import { checkRollback, publicReader } from './auto-release/production.mjs'
import { createApi, ApiError } from './auto-release/http.mjs'
import { buildIdentity, buildIdentityPlugin } from './build-identity-plugin.mjs'
import targetConfig from './auto-release/config.json' with { type: 'json' }
import { main } from './auto-release.mjs'

const oldFetch = globalThis.fetch
globalThis.fetch = () => {
  throw new Error('Tests must never access a real network')
}
after(() => {
  globalThis.fetch = oldFetch
})
const apply = { publish: true, enabled: true }
const code = (expected) => (e) => e.code === expected
const stable = (f) => ({
  mode: 'initialize',
  baselineSha: f.state.deployment.gitSource.sha,
  baselineVersion: 'v1.0.0',
})

test('dry-run completo: confirma produção, CI, SemVer e notas, sem nenhuma escrita', async () => {
  const f = fixture(),
    a = await publishRelease(f.config, f.services),
    b = await publishRelease(f.config, f.services)
  assert.equal(a.version, 'v1.0.1')
  assert.equal(a.sha, SHA_B)
  assert.equal(a.deploymentId, DEFAULT_DEPLOYMENT)
  assert.equal(a.planHash, b.planHash)
  assert.equal(a.dryRun, true)
  assert.equal(a.writes, 0)
  assert.equal(f.state.writes.length, 0)
  assert.match(a.notes, /## Correções/)
  assert.match(a.notes, /PR #80/)
  assert.equal(a.officialNotesStatus, 'deferred-until-publication')
  assert.ok(!f.state.calls.some((c) => c.path.endsWith('/releases/generate-notes')))
})
test('baseline inicial é explícito e nunca reanuncia o histórico', async () => {
  const f = fixture({ initialized: false })
  await assert.rejects(prepareRelease(f.config, f.services), code('EXPLICIT_BASELINE_REQUIRED'))
  await assert.rejects(
    prepareRelease(f.config, f.services, { ...stable(f), baselineSha: SHA_A }),
    code('BASELINE_NOT_CURRENT_PRODUCTION')
  )
  const p = await publishRelease(f.config, f.services, { ...stable(f), ...apply })
  assert.equal(p.version, 'v1.0.0')
  assert.match(p.notes, /Marco inicial/)
  assert.doesNotMatch(p.notes, /PR #80/)
  assert.equal(f.state.releases.length, 1)
  assert.equal(
    (await publishRelease(f.config, f.services, { ...stable(f), ...apply })).action,
    'noop'
  )
})
test('baseline não ignora tags anteriores nem sobrescreve tag de outro SHA', async () => {
  const f = fixture({ initialized: false })
  f.putTag('v2.0.0', SHA_A)
  await assert.rejects(
    prepareRelease(f.config, f.services, stable(f)),
    code('BASELINE_BELOW_EXISTING_TAG')
  )
  f.state.tags.clear()
  f.putTag('v1.0.0', SHA_A)
  await assert.rejects(prepareRelease(f.config, f.services, stable(f)), code('TAG_CONFLICT'))
})
test('inicialização pode adotar tag explícita já existente no MESMO commit ativo', async () => {
  const f = fixture({ initialized: false })
  f.putTag('v1.0.0', SHA_B)
  const p = await publishRelease(f.config, f.services, { ...stable(f), ...apply })
  assert.equal(p.action, 'published')
  assert.equal(f.state.writes.filter((x) => x.includes('/git/')).length, 0)
  assert.equal((await publishRelease(f.config, f.services)).action, 'noop')
})
for (const [labels, title, expected] of [
  [[], 'fix: corrigir bug', 'v1.0.1'],
  [['semver:patch'], 'ajuste', 'v1.0.1'],
  [['semver:minor'], 'novidade', 'v1.1.0'],
  [['semver:major'], 'incompatível', 'v2.0.0'],
  [[], 'feat: recurso', 'v1.1.0'],
  [['semver:patch'], 'feat!: remover contrato', 'v2.0.0'],
])
  test(`SemVer ${title} / ${labels} -> ${expected}`, async () => {
    const f = fixture()
    f.state.prs[0].title = title
    f.state.prs[0].labels.nodes = labels.map((name) => ({ name }))
    assert.equal((await prepareRelease(f.config, f.services)).version, expected)
  })
test('maior categoria acumulada vence e PRs são deduplicados por merge efetivamente incluído', async () => {
  const f = fixture()
  f.state.commits.push({ sha: 'd'.repeat(40), commit: { message: 'feat: outra mudança' } })
  f.state.prs.push({
    ...structuredClone(f.state.prs[0]),
    number: 81,
    title: 'feat: novidade',
    mergeCommit: { oid: 'd'.repeat(40) },
    labels: { pageInfo: { hasNextPage: false }, nodes: [{ name: 'semver:minor' }] },
  })
  const p = await prepareRelease(f.config, f.services)
  assert.equal(p.version, 'v1.1.0')
  assert.equal((p.notes.match(/PR #80/g) || []).length, 1)
  assert.equal((p.notes.match(/PR #81/g) || []).length, 1)
})
test('PR não integrado no intervalo não entra nas notas; commit direto permanece rastreável', async () => {
  const f = fixture()
  f.state.prs[0].mergeCommit.oid = SHA_A
  f.state.notesBody = ''
  const p = await prepareRelease(f.config, f.services)
  assert.doesNotMatch(p.notes, /PR #80/)
  assert.match(p.notes, /commit ccccccc/)
})
test('PR sem labels fica em categoria técnica com incremento previsível', async () => {
  const f = fixture()
  f.state.prs[0].title = 'Ajustar infraestrutura'
  f.state.prs[0].body = ''
  f.state.prs[0].labels.nodes = []
  const p = await prepareRelease(f.config, f.services)
  assert.equal(p.version, 'v1.0.1')
  assert.match(p.notes, /Alterações técnicas/)
})
test('segurança e breaking não são ocultados por release:skip', async () => {
  for (const label of ['security', 'semver:major']) {
    const f = fixture()
    f.state.prs[0].labels.nodes = [{ name: 'release:skip' }, { name: label }]
    const p = await prepareRelease(f.config, f.services)
    assert.equal(p.action, 'publish')
    assert.match(p.notes, label === 'security' ? /Segurança e estabilidade/ : /Compatibilidade/)
  }
})
test('ausência de alterações públicas não gera tag', async () => {
  const f = fixture()
  f.state.prs[0].labels.nodes = [{ name: 'release:skip' }]
  assert.equal((await publishRelease(f.config, f.services, apply)).reason, 'NO_PUBLIC_CHANGES')
  assert.equal(f.state.writes.length, 0)
})
test('redeploy do mesmo commit, evento repetido e reexecução não duplicam releases', async () => {
  const f = fixture()
  const first = await publishRelease(f.config, f.services, apply)
  const count = f.state.writes.length
  f.state.deployment.id =
    f.state.alias.deploymentId =
    f.state.project.targets.production.id =
    f.state.identity.deploymentId =
      'dpl_newRedeploy'
  const again = await publishRelease(f.config, f.services, apply)
  assert.equal(first.action, 'published')
  assert.equal(again.reason, 'COMMIT_ALREADY_RELEASED')
  assert.equal(f.state.writes.length, count)
})
test('commit sem mudança de árvore não cria nova versão', async () => {
  const f = fixture()
  f.state.treeB = f.state.treeA
  assert.equal(
    (await publishRelease(f.config, f.services, apply)).reason,
    'IDENTICAL_PUBLISHED_TREE'
  )
  assert.equal(f.state.writes.length, 0)
})
for (const [name, alter, expected] of [
  [
    'CI pendente',
    (f) => {
      f.state.run.status = 'in_progress'
    },
    'CI_PENDING',
  ],
  [
    'CI reprovado',
    (f) => {
      f.state.run.conclusion = 'failure'
    },
    'CI_FAILED',
  ],
  [
    'job obrigatório ausente',
    (f) => {
      f.state.jobs.pop()
    },
    'MANDATORY_JOB_NOT_APPROVED',
  ],
  [
    'job obrigatório ignorado',
    (f) => {
      f.state.jobs[0].conclusion = 'skipped'
    },
    'MANDATORY_JOB_NOT_APPROVED',
  ],
  [
    'workflow de PR',
    (f) => {
      f.state.run.event = 'pull_request'
    },
    'MAIN_CI_MISSING',
  ],
  [
    'workflow em execução mais recente',
    (f) => {
      f.state.intercept = (path) =>
        path.includes('/workflows/9/runs')
          ? {
              workflow_runs: [
                f.state.run,
                { ...f.state.run, run_number: 11, status: 'in_progress' },
              ],
            }
          : undefined
    },
    'CI_PENDING',
  ],
  [
    'Preview',
    (f) => {
      f.state.deployment.target = 'preview'
    },
    'PREVIEW_DEPLOYMENT',
  ],
  [
    'Ready sem promoção',
    (f) => {
      f.state.project.targets.production.id = 'dpl_other'
    },
    'DEPLOYMENT_NOT_ACTIVE',
  ],
  [
    'outro projeto',
    (f) => {
      f.state.deployment.projectId = 'prj_wrong'
    },
    'DEPLOYMENT_PROJECT_MISMATCH',
  ],
  [
    'outro repositório',
    (f) => {
      f.state.project.link.repo = 'wrong'
    },
    'PROJECT_REPOSITORY_MISMATCH',
  ],
  [
    'Git SHA ausente',
    (f) => {
      delete f.state.deployment.gitSource.sha
    },
    'UNPROVEN_GIT_SOURCE',
  ],
  [
    'Git SHA inválido',
    (f) => {
      f.state.deployment.gitSource.sha = 'main; curl bad'
    },
    'UNPROVEN_GIT_SOURCE',
  ],
  [
    'upload manual só com meta',
    (f) => {
      delete f.state.deployment.gitSource
      f.state.deployment.meta = { githubCommitSha: SHA_B }
    },
    'UNPROVEN_GIT_SOURCE',
  ],
  [
    'metadados conflitantes',
    (f) => {
      f.state.deployment.meta = { githubCommitSha: SHA_A }
    },
    'GIT_METADATA_CONFLICT',
  ],
  [
    'domínio outro projeto',
    (f) => {
      f.state.alias.projectId = 'prj_wrong'
    },
    'DOMAIN_PROJECT_MISMATCH',
  ],
  [
    'domínio não verificado',
    (f) => {
      f.state.domain.verified = false
    },
    'DOMAIN_NOT_VERIFIED',
  ],
  [
    'manifesto público outro commit',
    (f) => {
      f.state.identity.commit = SHA_A
    },
    'PUBLIC_IDENTITY_MISMATCH',
  ],
  [
    'manifesto de outro deployment',
    (f) => {
      f.state.identity.deploymentId = 'dpl_old'
    },
    'PUBLIC_IDENTITY_MISMATCH',
  ],
  [
    'rede falhou',
    (f) => {
      f.state.vercelError = true
    },
    'API_NETWORK_ERROR',
  ],
  [
    'domínio falhou',
    (f) => {
      f.state.publicError = true
    },
    'PUBLIC_IDENTITY_UNAVAILABLE',
  ],
  [
    'rollback ativo',
    (f) => {
      f.state.project.lastAliasRequest = {
        type: 'rollback',
        jobStatus: 'succeeded',
        toDeploymentId: DEFAULT_DEPLOYMENT,
        requestedAt: 100,
      }
    },
    'ROLLBACK_ACTIVE',
  ],
  [
    'rollback em curso',
    (f) => {
      f.state.project.lastAliasRequest = { type: 'rollback', jobStatus: 'in-progress' }
    },
    'ALIAS_OPERATION_NOT_SETTLED',
  ],
  [
    'rollback sem dados suficientes',
    (f) => {
      f.state.project.rollbackDescription = { description: 'rollback' }
    },
    'ROLLBACK_STATE_UNCERTAIN',
  ],
])
  test(`bloqueio: ${name}`, async () => {
    const f = fixture()
    alter(f)
    await assert.rejects(publishRelease(f.config, f.services, apply), code(expected))
    assert.equal(f.state.writes.length, 0)
  })
test('commit fora da história da main e histórico revertido bloqueiam publicação', async () => {
  for (const main of [true, false]) {
    const f = fixture()
    f.state.intercept = (path) =>
      path.includes(`/compare/${main ? SHA_B : SHA_A}...`)
        ? { status: 'behind', commits: [], total_commits: 0 }
        : undefined
    await assert.rejects(
      publishRelease(f.config, f.services, apply),
      code(main ? 'COMMIT_NOT_IN_MAIN' : 'ROLLBACK_OR_DIVERGED_HISTORY')
    )
    assert.equal(f.state.writes.length, 0)
  }
})
test('CLI autorizada com gitSource oficial passa; eventos Preview e payloads falsificados não', async () => {
  const f = fixture()
  f.state.deployment.source = 'cli'
  assert.equal((await prepareRelease(f.config, f.services)).action, 'publish')
  const event = {
    name: 'repository_dispatch',
    action: 'vercel.deployment.promoted',
    client_payload: {
      id: DEFAULT_DEPLOYMENT,
      environment: 'production',
      project: { id: f.config.vercelProjectId },
      url: 'https://attacker.invalid',
    },
  }
  assert.equal((await prepareRelease(f.config, f.services, { event })).sha, SHA_B)
  event.client_payload.environment = 'preview'
  await assert.rejects(
    publishRelease(f.config, f.services, { ...apply, event }),
    code('PREVIEW_EVENT')
  )
  event.client_payload.environment = 'production'
  event.client_payload.project.id = 'prj_wrong'
  await assert.rejects(
    prepareRelease(f.config, f.services, { event }),
    code('EVENT_PROJECT_MISMATCH')
  )
})
test('evento antigo não publica o deployment atualmente ativo no lugar do evento', async () => {
  const f = fixture()
  const event = {
    name: 'workflow_run',
    workflow_run: {
      head_sha: SHA_A,
      head_branch: 'main',
      head_repository: { id: f.config.repositoryId },
    },
  }
  await assert.rejects(
    publishRelease(f.config, f.services, { ...apply, event }),
    code('STALE_CI_EVENT')
  )
  assert.equal(f.state.writes.length, 0)
})
test('promoção explícita recupera rollback; histórico antigo não bloqueia um novo Git deploy', () => {
  checkRollback(
    { lastAliasRequest: { type: 'promote', jobStatus: 'succeeded' }, rollbackDescription: {} },
    { id: DEFAULT_DEPLOYMENT }
  )
  checkRollback(
    {
      lastAliasRequest: {
        type: 'rollback',
        jobStatus: 'succeeded',
        requestedAt: 100,
        toDeploymentId: 'dpl_old',
      },
    },
    { id: DEFAULT_DEPLOYMENT, createdAt: 200 }
  )
})
test('tag existente com outro commit bloqueia inclusive dry-run', async () => {
  const f = fixture()
  f.putTag('v1.0.1', SHA_A)
  await assert.rejects(prepareRelease(f.config, f.services), code('TAG_CONFLICT'))
  assert.equal(f.state.writes.length, 0)
})
test('tag publicada movida ou prova adulterada bloqueia', async () => {
  const f = fixture()
  f.putTag(
    'v1.0.0',
    SHA_B,
    encodeMarker({
      schema: 1,
      repository: f.config.repository,
      version: 'v1.0.0',
      sha: SHA_B,
      planHash: '0'.repeat(64),
    })
  )
  await assert.rejects(prepareRelease(f.config, f.services), code('PUBLISHED_TAG_CHANGED'))
})
for (const field of ['loseTagObjectResponse', 'loseRefResponse', 'loseReleaseResponse'])
  test(`perda de resposta: ${field}, reprocessa sem duplicar`, async () => {
    const f = fixture()
    f.state[field] = true
    try {
      await publishRelease(f.config, f.services, apply)
    } catch (e) {
      assert.equal(e.code, 'API_NETWORK_ERROR')
    }
    await publishRelease(f.config, f.services, apply)
    assert.equal(f.state.releases.filter((r) => r.tag_name === 'v1.0.1').length, 1)
    assert.equal([...f.state.tags.keys()].filter((v) => v === 'v1.0.1').length, 1)
  })
test('duas execuções concorrentes criam somente uma Release e uma referência de tag', async () => {
  const f = fixture()
  await Promise.all([
    publishRelease(f.config, f.services, apply),
    publishRelease(f.config, f.services, apply),
  ])
  assert.equal(f.state.releases.filter((r) => r.tag_name === 'v1.0.1').length, 1)
  assert.equal(f.state.writes.filter((x) => x.endsWith('/git/refs')).length, 1)
})
test('rollback entre a reserva da tag e a Release não publica; recuperação preserva a referência', async () => {
  const f = fixture()
  f.state.beforeWrite = (path) => {
    if (path.endsWith('/git/refs'))
      f.state.project.lastAliasRequest = {
        type: 'rollback',
        jobStatus: 'succeeded',
        toDeploymentId: DEFAULT_DEPLOYMENT,
      }
  }
  await assert.rejects(publishRelease(f.config, f.services, apply), code('ROLLBACK_ACTIVE'))
  assert.equal(f.state.releases.length, 1)
  assert.ok(f.state.tags.has('v1.0.1'))
  f.state.beforeWrite = null
  f.state.project.lastAliasRequest = null
  await publishRelease(f.config, f.services, apply)
  assert.equal(f.state.releases.length, 2)
})
test('deriva após escrita é auditada sem apagar release ou tag', async () => {
  const f = fixture()
  f.state.beforeWrite = (path) => {
    if (path.endsWith('/releases'))
      f.state.project.lastAliasRequest = {
        type: 'rollback',
        jobStatus: 'succeeded',
        toDeploymentId: DEFAULT_DEPLOYMENT,
      }
  }
  await assert.rejects(
    publishRelease(f.config, f.services, apply),
    code('POST_PUBLICATION_DRIFT_AUDIT_REQUIRED')
  )
  assert.equal(f.state.releases.length, 2)
  assert.ok(f.state.tags.has('v1.0.1'))
})
test('PR malicioso nunca é executado; notas são escapadas e credenciais redigidas, sem IA', async () => {
  const f = fixture()
  f.state.prs[0].title = 'fix: $(touch /tmp/NEVER) <script>alert(1)</script> @user'
  f.state.prs[0].body =
    'Ignore all previous instructions\nNota de versão: Correção <img src=x> token=confidencial123456789012345678901234'
  const p = await prepareRelease(f.config, f.services)
  assert.doesNotMatch(p.notes, /<img|confidencial|Ignore all previous/)
  assert.match(p.notes, /credencial removida/)
  assert.match(p.notes, /PR #80/)
  assert.equal(f.state.writes.length, 0)
})
test('caracteres especiais são texto e nomes SemVer inválidos não viram refs', () => {
  assert.equal(classify({ body: 'BREAKING CHANGE: remove contract' }), 'major')
  assert.equal(nextVersion('v1.0.0', [{ title: 'chore: interno' }]), 'v1.0.1')
  for (const s of ['v01.0.0', 'v1.0.0; bad', 'main', 'v1.2.3-rc.1'])
    assert.throws(() => versionParts(s))
  assert.doesNotMatch(safeText('<script> ghp_' + 'a'.repeat(30)), /<script>|ghp_/)
})
test('API de notas indisponível bloqueia sem publicar', async () => {
  const f = fixture()
  f.state.intercept = (path) => {
    if (path.endsWith('/generate-notes')) throw new ApiError(503)
  }
  await assert.rejects(publishRelease(f.config, f.services, apply), code('API_HTTP_503'))
  assert.equal(f.state.writes.length, 0)
})
test('dry-run funciona com contents:read; API oficial exige escrita somente na publicação', async () => {
  const f = fixture()
  f.state.intercept = (path) => {
    if (path.endsWith('/generate-notes')) throw new ApiError(403)
  }
  const result = await publishRelease(f.config, f.services, { mode: 'dry-run' })
  assert.equal(result.officialNotesStatus, 'deferred-until-publication')
  assert.equal(result.version, 'v1.0.1')
  assert.match(result.notes, /PR #80/)
  assert.ok(!f.state.calls.some((call) => call.path.endsWith('/generate-notes')))
  await assert.rejects(publishRelease(f.config, f.services, apply), code('API_HTTP_403'))
  assert.equal(f.state.writes.length, 0)
})
test('operação de publicação é desativada por padrão e CLI não aceita branch não confiável', async () => {
  const f = fixture()
  await assert.rejects(
    publishRelease(f.config, f.services, { publish: true }),
    code('PUBLICATION_DISABLED')
  )
  assert.equal(f.state.writes.length, 0)
  await assert.rejects(main(['--publish'], {}), code('PUBLICATION_DISABLED'))
  await assert.rejects(
    main([], { GITHUB_REPOSITORY: targetConfig.repository, GITHUB_REF: 'refs/heads/untrusted' }),
    code('WORKFLOW_NOT_ON_MAIN')
  )
})
test('cliente HTTP não envia credenciais a hosts arbitrários, nem escreve na Vercel', async () => {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init })
    return new Response('{}', { status: 200 })
  }
  const api = createApi('https://api.vercel.com', 'private-token', { fetchImpl, writable: true })
  await assert.rejects(api('/v9/projects/x', 'PATCH', {}), code('VERCEL_IS_READ_ONLY'))
  await assert.rejects(api('//evil.invalid'), code('INVALID_API_PATH'))
  await api('/v9/projects/x')
  assert.equal(requests[0].init.redirect, 'error')
  assert.equal(new URL(requests[0].url).host, 'api.vercel.com')
  const gh = createApi('https://api.github.com', 't', { fetchImpl })
  await assert.rejects(gh('/repos/o/r/releases', 'POST', {}), code('READ_ONLY_MODE'))
  await assert.rejects(
    gh('/repos/o/r/releases/generate-notes', 'POST', {}),
    code('OFFICIAL_NOTES_REQUIRE_WRITE_PERMISSION')
  )
  const publisher = createApi('https://api.github.com', 't', { fetchImpl, writable: true })
  await publisher('/repos/o/r/releases/generate-notes', 'POST', {})
})
test('falhas HTTP não imprimem corpo remoto nem token', async () => {
  const api = createApi('https://api.github.com', 'private-token', {
    fetchImpl: async () => new Response('private-token', { status: 401 }),
  })
  await assert.rejects(
    api('/user'),
    (e) => e.code === 'API_HTTP_401' && !e.message.includes('private-token')
  )
})
test('verificação pública não envia Authorization e recusa HTML/redirect/identidade de cache', async () => {
  let options
  const reader = publicReader(async (_url, init) => {
    options = init
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } })
  })
  await reader('https://www.evolutus.com.br/.well-known/evolutus-build.json')
  assert.equal(options.redirect, 'error')
  assert.equal(options.headers.Authorization, undefined)
  await assert.rejects(
    publicReader(
      async () => new Response('login', { status: 200, headers: { 'Content-Type': 'text/html' } })
    )('https://www.evolutus.com.br/build'),
    code('PUBLIC_IDENTITY_UNAVAILABLE')
  )
})
test('manifesto de build inclui somente identidade pública e não traz tokens ou versão inventada', () => {
  const id = buildIdentity({
    VERCEL_GIT_COMMIT_SHA: SHA_B,
    VERCEL_DEPLOYMENT_ID: DEFAULT_DEPLOYMENT,
    VERCEL_PROJECT_ID: targetConfig.vercelProjectId,
    GITHUB_TOKEN: 'NEVER',
    VERCEL_TOKEN: 'NEVER',
  })
  assert.equal(id.commit, SHA_B)
  assert.equal(id.version, undefined)
  assert.doesNotMatch(JSON.stringify(id), /NEVER|TOKEN/)
  assert.equal(buildIdentity({}).commit, null)
  const emitted = []
  const plugin = buildIdentityPlugin()
  plugin.generateBundle.call({ emitFile: (v) => emitted.push(v) })
  assert.equal(emitted[0].fileName, '.well-known/evolutus-build.json')
  assert.equal(plugin.enforce, 'post')
})
test('workflow preserva privilégio mínimo, contexto main, concorrência e ativação explícita', async () => {
  const yaml = await readFile(
    new URL('../../.github/workflows/auto-release.yml', import.meta.url),
    'utf8'
  )
  assert.equal((yaml.match(/contents: write/g) || []).length, 1)
  assert.match(yaml, /EVOLUTUS_AUTO_RELEASE_ENABLED == 'true'/)
  assert.match(yaml, /github.ref == 'refs\/heads\/main'/)
  assert.match(yaml, /cancel-in-progress: false/)
  assert.match(yaml, /default: dry-run/)
  assert.doesNotMatch(yaml, /pull_request_target|ref:.*client_payload|npm ci|--admin|--force/)
  for (const action of yaml.matchAll(/uses: (\S+)/g)) assert.match(action[1], /@[a-f0-9]{40}$/)
})
test('demo de fluxo inteiro roda isolada e propõe tag/conteúdo sem escritas', () => {
  const data = JSON.parse(
    execFileSync(process.execPath, ['scripts/release/auto-release/dry-run-demo.mjs'], {
      cwd: new URL('../..', import.meta.url),
      env: {},
      encoding: 'utf8',
    })
  )
  assert.equal(data.networkCalls, 0)
  assert.equal(data.githubWrites, 0)
  assert.equal(data.vercelWrites, 0)
  assert.equal(data.repeatedDryRunIdentical, true)
  assert.equal(data.proposedTag.ref, 'refs/tags/v1.0.1')
})

test('não permite modificar/deletar refs, fontes ou Releases existentes, mesmo no cliente com escrita', async () => {
  const gh = createApi('https://api.github.com', 't', {
    writable: true,
    repository: 'example/repo',
    fetchImpl: async () => new Response('{}'),
  })
  for (const method of ['PATCH', 'DELETE'])
    await assert.rejects(
      gh('/repos/example/repo/releases/1', method, {}),
      code('WRITE_NOT_ALLOWED')
    )
  await assert.rejects(gh('/repos/example/other/releases', 'POST', {}), code('WRITE_NOT_ALLOWED'))
  await assert.rejects(
    gh('/repos/example/repo/git/refs', 'POST', { ref: 'refs/heads/main', sha: SHA_B }),
    code('INVALID_TAG_WRITE')
  )
  await assert.rejects(
    gh('/repos/example/repo/git/refs', 'POST', {
      ref: 'refs/tags/v1.0.0',
      sha: SHA_B,
      force: true,
    }),
    code('TAG_FORCE_FORBIDDEN')
  )
})
test('prova reservada em texto de PR é removida e não pode falsificar o registro da Release', async () => {
  const f = fixture()
  f.state.prs[0].body = 'Nota de versão: Ajuste evolutus-release-v1:malicious'
  const p = await publishRelease(f.config, f.services, apply)
  assert.equal(p.action, 'published')
  assert.doesNotMatch(p.notes, /evolutus-release-v1:/)
})
test('tag sem prova, notes fora do intervalo e associações truncadas bloqueiam sem escrita', async () => {
  const f = fixture()
  f.putTag('v1.0.1', SHA_B)
  await assert.rejects(
    prepareRelease(f.config, f.services),
    code('MISSING_OR_AMBIGUOUS_RELEASE_PROOF')
  )
  f.state.tags.delete('v1.0.1')
  f.state.notesBody = `https://github.com/${f.config.repository}/pull/999`
  await assert.rejects(prepareRelease(f.config, f.services, apply), code('OFFICIAL_NOTES_RANGE_MISMATCH'))
  f.state.notesBody = ''
  f.state.prs[0].labels.pageInfo.hasNextPage = true
  await assert.rejects(prepareRelease(f.config, f.services), code('INCOMPLETE_PR_METADATA'))
  assert.equal(f.state.writes.length, 0)
})
test('notas oficiais aceitam PR aninhado somente quando seu merge está no intervalo publicado', async () => {
  const f = fixture()
  f.state.notesBody += `\n- PR aninhado https://github.com/${f.config.repository}/pull/98`
  f.state.intercept = (path) => path.endsWith('/pulls/98')
    ? {
        number: 98,
        merged_at: '2026-10-26T11:00:00Z',
        merge_commit_sha: SHA_C,
        base: { repo: { full_name: f.config.repository }, ref: 'integration' },
      }
    : undefined
  const plan = await prepareRelease(f.config, f.services, apply)
  assert.equal(plan.officialNotesStatus, 'verified')
  assert.equal(f.state.writes.length, 0)

  f.state.intercept = (path) => path.endsWith('/pulls/98')
    ? {
        number: 98,
        merged_at: '2026-10-26T11:00:00Z',
        merge_commit_sha: SHA_A,
        base: { repo: { full_name: f.config.repository }, ref: 'integration' },
      }
    : undefined
  await assert.rejects(prepareRelease(f.config, f.services, apply), code('OFFICIAL_NOTES_RANGE_MISMATCH'))
  assert.equal(f.state.writes.length, 0)
})
test('negação da proteção de tags não é contornada', async () => {
  const f = fixture()
  f.state.intercept = (path, method) => {
    if (method === 'POST' && path.endsWith('/git/refs')) throw new ApiError(403)
  }
  await assert.rejects(publishRelease(f.config, f.services, apply), code('API_HTTP_403'))
  assert.equal(f.state.releases.length, 1)
  assert.equal(f.state.tags.has('v1.0.1'), false)
})
test('PRs e eventos falsos não substituem a origem oficial', async () => {
  const f = fixture()
  f.state.deployment.meta = { githubCommitRepo: 'other' }
  await assert.rejects(
    prepareRelease(f.config, f.services),
    code('GIT_REPOSITORY_METADATA_CONFLICT')
  )
  f.state.deployment.meta = {}
  await assert.rejects(
    prepareRelease(f.config, f.services, {
      event: {
        name: 'repository_dispatch',
        action: 'vercel.deployment.success',
        client_payload: {
          environment: 'production',
          id: DEFAULT_DEPLOYMENT,
          project: { id: f.config.vercelProjectId },
          git: { sha: SHA_A },
        },
      },
    }),
    code('EVENT_COMMIT_MISMATCH')
  )
})
test('run de fork, credenciais ausentes e configuração insegura falham fechados', async () => {
  const f = fixture()
  f.state.run.head_repository.id = 999
  await assert.rejects(prepareRelease(f.config, f.services), code('MAIN_CI_MISSING'))
  await assert.rejects(main([], {}), code('MISSING_CREDENTIALS'))
  await assert.rejects(
    main(['--publish'], { EVOLUTUS_AUTO_RELEASE_ENABLED: 'true' }),
    code('PUBLICATION_REQUIRES_TRUSTED_WORKFLOW')
  )
  await assert.rejects(
    prepareRelease({ ...f.config, productionDomain: 'evil.invalid/path' }, f.services),
    code('INVALID_CONFIG')
  )
})
test('labels são normalizados e escopos de segurança não podem ser ocultados', () => {
  assert.equal(classify({ labels: ['Semver:Major'] }), 'major')
  assert.equal(classify({ title: 'fix(auth): ajustar sessão' }), 'patch')
})

test('modo dry-run recusa escrita mesmo com opção de publicação e credenciais habilitadas', async () => {
  const f = fixture()
  await assert.rejects(
    publishRelease(f.config, f.services, { ...apply, mode: 'dry-run' }),
    code('DRY_RUN_CANNOT_PUBLISH')
  )
  await assert.rejects(
    main(['--publish'], { RELEASE_MODE: 'dry-run', EVOLUTUS_AUTO_RELEASE_ENABLED: 'true' }),
    code('DRY_RUN_CANNOT_PUBLISH')
  )
  assert.equal(f.state.writes.length, 0)
})
test('GraphQL de consulta não pode ser usado como canal alternativo de escrita', async () => {
  const api = createApi('https://api.github.com', 't', {
    fetchImpl: async () => new Response('{}'),
  })
  await assert.rejects(
    api('/graphql', 'POST', { query: 'mutation { createRef { id } }' }),
    code('GRAPHQL_MUST_BE_READ_ONLY')
  )
  await api('/graphql', 'POST', { query: 'query{viewer{login}}' })
})
test('e-mails e documentos pessoais não são copiados das notas de PR', () => {
  const text = safeText('Ajuste para pessoa@example.com e 123.456.789-00')
  assert.doesNotMatch(text, /pessoa@example|123\.456/)
})
