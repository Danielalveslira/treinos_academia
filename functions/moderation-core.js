// Papéis que nunca podem ser alvo de denúncia nem de penalidade de moderação.
// Hoje o sistema só distingue 'user' e 'superadmin' — se um papel intermediário
// (ex.: 'admin') for criado, basta incluí-lo aqui; toda checagem que usa
// isProtectedRole (criação de denúncia e aplicação de decisões) passa a valer
// para ele também, sem precisar tocar em cada chamada.
const PROTECTED_ROLES = new Set(['admin', 'superadmin'])

export function isProtectedRole(role) {
  return PROTECTED_ROLES.has(role)
}

export const REPORT_PROTECTED_AUTHOR_ERROR =
  'Publicações e interações de administradores não podem ser denunciadas.'

// O autor de uma publicação já pode excluí-la diretamente (sem passar pela fila de
// moderação) — denunciar a própria publicação não tem nenhum uso legítimo e só
// gastaria tempo de análise do superadmin com pedidos que não são denúncias de
// verdade. Ver isReportableAuthor em src/utils/moderation.js: mesma regra, espelhada
// no cliente só para esconder o botão; a decisão de verdade é sempre esta aqui.
export const REPORT_OWN_STATUS_ERROR = 'Você não pode denunciar sua própria publicação.'

export function isSelfReport(authorId, reporterId) {
  return authorId === reporterId
}
