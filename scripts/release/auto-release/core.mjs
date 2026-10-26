import { createHash } from 'node:crypto'

export class ReleaseError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ReleaseError'
    this.code = code
  }
}
export function requireFact(condition, code) {
  if (!condition) throw new ReleaseError(code)
}
export const validSha = (s) => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s)
export const validDeployment = (s) => typeof s === 'string' && /^dpl_[a-zA-Z0-9]{1,100}$/.test(s)
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function versionParts(tag) {
  requireFact(
    typeof tag === 'string' && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag),
    'INVALID_SEMVER'
  )
  const parts = tag.slice(1).split('.').map(Number)
  requireFact(parts.every(Number.isSafeInteger), 'INVALID_SEMVER')
  return parts
}
export function compareVersions(a, b) {
  const x = versionParts(a),
    y = versionParts(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1
  return 0
}
export function bumpVersion(previous, level) {
  const v = versionParts(previous)
  if (level === 'major') {
    v[0]++
    v[1] = v[2] = 0
  } else if (level === 'minor') {
    v[1]++
    v[2] = 0
  } else {
    v[2]++
  }
  requireFact(v.every(Number.isSafeInteger), 'INVALID_SEMVER')
  return `v${v.join('.')}`
}
export function classify(change) {
  const labels = (change.labels || []).map((l) => l.toLowerCase())
  const text = `${change.title || ''}\n${change.body || ''}`
  const breaking =
    /^[\w-]+(?:\([^\r\n)]*\))?!:/m.test(text) || /^BREAKING[ -]CHANGE:\s*\S/m.test(text)
  if (breaking || labels.includes('semver:major')) return 'major'
  if (
    labels.includes('semver:minor') ||
    /^(feat)(?:\([^\r\n)]*\))?:/i.test(text) ||
    labels.includes('feature')
  )
    return 'minor'
  return 'patch'
}
export function nextVersion(previous, changes) {
  const levels = changes.map(classify)
  return bumpVersion(
    previous,
    levels.includes('major') ? 'major' : levels.includes('minor') ? 'minor' : 'patch'
  )
}
export function safeText(value) {
  return String(value || '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(
      /(?:github_pat_[\w]+|gh[pousr]_[\w]{20,}|\bsk-[\w-]{20,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+|(?:password|secret|token|bearer)\s*[:= ]\s*\S+)/gi,
      '[credencial removida]'
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[e-mail removido]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[documento removido]')
    .replace(/evolutus-release-v1:/gi, '[metadado reservado removido]')
    .replace(/https?:\/\/\S+/gi, '[URL removida]')
    .slice(0, 400)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;')
    .replace(/[\\`*_{}[\]()#!|~]/g, '\\$&')
}
const categories = [
  'Novidades',
  'Melhorias',
  'Correções',
  'Segurança e estabilidade',
  'Alterações técnicas',
]
export function category(change) {
  const l = (change.labels || []).map((l) => l.toLowerCase()),
    title = change.title || ''
  if (
    l.some((x) => ['security', 'stability', 'segurança'].includes(x)) ||
    /^[\w-]+\((?:security|auth|rls)\)/i.test(title)
  )
    return categories[3]
  if (
    classify(change) === 'major' ||
    l.includes('semver:minor') ||
    l.includes('feature') ||
    /^feat(?:\([^)]*\))?!?:/i.test(title)
  )
    return categories[0]
  if (l.some((x) => ['enhancement', 'ui', 'mobile', 'performance', 'accessibility'].includes(x)))
    return categories[1]
  if (l.some((x) => ['bug', 'fix'].includes(x)) || /^fix(?:\([^)]*\))?:/i.test(title))
    return categories[2]
  return categories[4]
}
export function publicChanges(changes) {
  return changes.filter(
    (c) =>
      !c.labels?.some((l) => l.toLowerCase() === 'release:skip') ||
      classify(c) === 'major' ||
      category(c) === categories[3]
  )
}
export function formatNotes(config, plan, changes) {
  const lines = [`# Evolutus ${plan.version}`, '', 'Publicação confirmada no domínio oficial.', '']
  if (plan.initialization)
    lines.push(
      '## Marco inicial',
      '',
      'Esta versão estabelece o baseline explícito. Não anuncia alterações históricas como novidades.',
      ''
    )
  for (const group of categories) {
    const items = publicChanges(changes).filter((c) => category(c) === group)
    if (!items.length) continue
    lines.push(`## ${group}`, '')
    for (const c of items) {
      const note = c.body?.match(/^Nota de vers[aã]o:\s*(.+)$/im)?.[1] || c.title
      const target = c.number ? `pull/${c.number}` : `commit/${c.sha}`
      lines.push(
        `- ${safeText(note)} ([${c.number ? `PR #${c.number}` : `commit ${c.sha.slice(0, 7)}`}](https://github.com/${config.repository}/${target}))`
      )
    }
    lines.push('')
  }
  if (changes.some((c) => classify(c) === 'major'))
    lines.push(
      '## Compatibilidade',
      '',
      'Há sinalização de alteração incompatível no intervalo. Consulte os PRs e commits relacionados antes de atualizar integrações.',
      ''
    )
  if (plan.previous)
    lines.push(
      `[Comparar com ${plan.previous.version}](https://github.com/${config.repository}/compare/${plan.previous.version}...${plan.sha})`,
      ''
    )
  lines.push(
    '## Publicação verificada',
    '',
    `- Domínio: https://${config.productionDomain}`,
    `- Commit: \`${plan.sha}\``,
    `- Deployment: \`${plan.deploymentId}\``,
    `- CI: https://github.com/${config.repository}/actions/runs/${plan.ciRunId}`,
    ''
  )
  return lines.join('\n')
}
export const markerPrefix = 'evolutus-release-v1:'
export function encodeMarker(record) {
  return `${markerPrefix}${Buffer.from(JSON.stringify(record)).toString('base64url')}`
}
export function decodeMarker(text) {
  const matches = String(text || '').match(/evolutus-release-v1:([A-Za-z0-9_-]+)/g) || []
  requireFact(matches.length === 1, 'MISSING_OR_AMBIGUOUS_RELEASE_PROOF')
  let value
  try {
    value = JSON.parse(Buffer.from(matches[0].slice(markerPrefix.length), 'base64url').toString())
  } catch {
    throw new ReleaseError('INVALID_RELEASE_PROOF')
  }
  requireFact(
    value.schema === 1 && validSha(value.sha) && /^[a-f0-9]{64}$/.test(value.planHash),
    'INVALID_RELEASE_PROOF'
  )
  versionParts(value.version)
  return value
}

export function validateConfig(config) {
  requireFact(
    config.schema === 1 && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(config.repository),
    'INVALID_CONFIG'
  )
  requireFact(
    config.branch === 'main' &&
      Number.isSafeInteger(config.repositoryId) &&
      config.repositoryId > 0,
    'INVALID_CONFIG'
  )
  requireFact(
    /^prj_[A-Za-z0-9]+$/.test(config.vercelProjectId) &&
      /^team_[A-Za-z0-9]+$/.test(config.vercelTeamId),
    'INVALID_CONFIG'
  )
  requireFact(
    /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(config.productionDomain) &&
      /^\/\.well-known\/[a-z0-9.-]+\.json$/.test(config.identityPath),
    'INVALID_CONFIG'
  )
  requireFact(
    config.workflow === 'supabase-tests.yml' &&
      ['js', 'sql', 'secrets', 'finance-quality'].every((n) => config.requiredJobs.includes(n)),
    'INVALID_CONFIG'
  )
}
