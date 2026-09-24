// Papéis que nunca podem ser alvo de denúncia nem de penalidade de moderação.
// Hoje o sistema só distingue 'user' e 'superadmin' — se um papel intermediário
// (ex.: 'admin') for criado, basta incluí-lo aqui; toda checagem que usa
// isProtectedRole (criação de denúncia e aplicação de decisões) passa a valer
// para ele também, sem precisar tocar em cada chamada.
const PROTECTED_ROLES = new Set(['admin', 'superadmin'])

export function isProtectedRole(role) {
  return PROTECTED_ROLES.has(role)
}

// Cobre publicações e vitrines (profissionais/estabelecimentos) igualmente -- ambas
// passam pelo mesmo canal único de denúncia (submitSupportRequest em index.js).
export const REPORT_PROTECTED_AUTHOR_ERROR =
  'Publicações, vitrines e interações de administradores não podem ser denunciadas.'

// O autor de uma publicação já pode excluí-la diretamente (sem passar pela fila de
// moderação) — denunciar a própria publicação não tem nenhum uso legítimo e só
// gastaria tempo de análise do superadmin com pedidos que não são denúncias de
// verdade. Ver isReportableAuthor em src/utils/moderation.js: mesma regra, espelhada
// no cliente só para esconder o botão; a decisão de verdade é sempre esta aqui.
export const REPORT_OWN_STATUS_ERROR = 'Você não pode denunciar sua própria publicação.'

// Mesma regra de isSelfReport, aplicada ao titular de uma vitrine (Vitrine V1 --
// canal único de denúncia). Despublicar/excluir a própria vitrine já está disponível
// em "Minha vitrine"; denunciá-la não tem uso legítimo.
export const REPORT_OWN_LISTING_ERROR = 'Você não pode denunciar sua própria vitrine.'

export function isSelfReport(authorId, reporterId) {
  return authorId === reporterId
}

// Mesmo formato de decisão/aviso/restrição que decideSupportRequest grava em index.js —
// reaproveitado para que uma restrição automática (rate-limit-service.js) também apareça
// com protocolo em /atendimento e aceite recurso (submitSupportRequest valida contra
// moderationDecisions). Sem isso, a restrição bloquearia a conta de verdade mas de forma
// muda, sem explicação e sem caminho de recurso.
//
// Puro de propósito (sem Timestamp/FieldValue do Admin SDK): quem chama decide o
// `until`/`createdAt` e anexa nos três objetos antes de gravar, o que deixa a montagem
// da decisão testável sem emulador.
export function buildAutomatedSuspension({ authorId, decisionId, windowCount, windowMinutes }) {
  const reason = `${windowCount} publicações em menos de ${windowMinutes} minutos.`
  return {
    decision: {
      requestId: '',
      adminId: 'system',
      automated: true,
      targetUserId: authorId,
      action: 'temporary_suspension',
      communityId: '',
      rule: 'Limite automático de publicações',
      reason,
      evidence: '',
    },
    notice: {
      action: 'temporary_suspension',
      rule: 'Limite automático de publicações',
      reason,
      communityId: '',
    },
    restriction: {
      action: 'temporary_suspension',
      decisionId,
    },
  }
}
