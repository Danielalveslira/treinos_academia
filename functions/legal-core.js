import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

export function legalDigest(manifest, documents) {
  return createHash('sha256').update(JSON.stringify({ manifest, documents })).digest('hex')
}

export function validateAcceptance(data, manifest) {
  if (!manifest.published || !manifest.controllerName || !manifest.contactEmail) {
    return 'Os documentos ainda estão em revisão.'
  }
  if (data?.version !== manifest.version) return 'A versão mudou. Releia os documentos.'
  if (data.accepted !== true || data.healthDataConsent !== true || data.ageConfirmed !== true) {
    return 'Confirme os documentos, a idade e a autorização específica para os dados de treino.'
  }
  return null
}

export function requestIp(request) {
  // O endereço vem da requisição resolvida pela infraestrutura Firebase, nunca do payload.
  const ip = request.rawRequest?.ip
  if (!ip || !isIP(ip)) throw new Error('Não foi possível registrar o endereço da solicitação.')
  return ip
}

export function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

export function validateSupportRequest(data) {
  if (!['report', 'appeal', 'privacy', 'billing'].includes(data?.kind)) return 'Tipo inválido.'
  if (
    typeof data.message !== 'string' ||
    data.message.trim().length < 10 ||
    data.message.length > 3000
  ) {
    return 'Descreva o pedido usando entre 10 e 3.000 caracteres.'
  }
  for (const field of ['statusId', 'communityId', 'decisionId']) {
    if (data[field] && !validId(data[field])) return 'Referência inválida.'
  }
  if (data.kind === 'appeal' && !validId(data.decisionId)) return 'Informe o protocolo da decisão.'
  return null
}

export const ACTIONS = [
  'no_action',
  'warning',
  'remove_content',
  'temporary_suspension',
  'community_ban',
  'system_ban',
  'restore',
]

export function validateDecision(data) {
  if (!validId(data?.requestId) || !ACTIONS.includes(data.action)) return 'Decisão inválida.'
  for (const field of ['reason', 'rule', 'evidence']) {
    if (
      typeof data[field] !== 'string' ||
      data[field].trim().length < 5 ||
      data[field].length > 3000
    ) {
      return 'Informe regra, evidências e fundamentação (5 a 3.000 caracteres por campo).'
    }
  }
  if (!['no_action', 'remove_content'].includes(data.action) && !validId(data.targetUserId)) {
    return 'Informe o usuário atingido.'
  }
  if (
    data.action === 'temporary_suspension' &&
    (!Number.isInteger(data.days) || data.days < 1 || data.days > 30)
  ) {
    return 'Informe uma suspensão entre 1 e 30 dias.'
  }
  if (data.action === 'community_ban' && !validId(data.communityId)) return 'Informe a comunidade.'
  if (data.action === 'restore' && data.communityId && !validId(data.communityId))
    return 'Comunidade inválida.'
  return null
}
