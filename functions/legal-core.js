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
  if (data.accepted !== true || data.healthDataConsent !== true) {
    return 'Confirme os documentos e a autorização específica para os dados de treino.'
  }
  return null
}

// Espelha calculateAge em src/utils/age.js (runtimes diferentes, sem um pacote
// compartilhado entre functions/ e src/ — replicado, não importado, mesmo padrão já
// usado por outras validações client/server deste projeto). Nunca confia num
// "ageConfirmed" que o cliente poderia mandar: calcula a idade de verdade a partir da
// data de nascimento já gravada em users/{uid} (ver acceptLegalDocuments em index.js).
export function calculateAge(birthDateValue, now = new Date()) {
  const birth = birthDateValue?.toDate ? birthDateValue.toDate() : new Date(birthDateValue)
  let age = now.getFullYear() - birth.getFullYear()
  const hadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate())
  if (!hadBirthdayThisYear) age -= 1
  return age
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
  if (!['report', 'appeal', 'privacy'].includes(data?.kind)) return 'Tipo inválido.'
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

const ACTIONS = [
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
  // Formato validado sempre que presente (não só para community_ban/restore) — o
  // valor é interpolado num caminho do Firestore (deletionJobs/community_${communityId})
  // antes de qualquer checagem específica de ação, em decideSupportRequest. Sem isso,
  // um valor malformado em qualquer outra ação batia num erro interno feio do
  // db.doc() em vez de cair aqui como mensagem de validação limpa.
  if (data.communityId != null && data.communityId !== '' && !validId(data.communityId))
    return 'Comunidade inválida.'
  if (data.action === 'community_ban' && !data.communityId) return 'Informe a comunidade.'
  return null
}
