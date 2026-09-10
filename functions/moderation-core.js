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
