import { ShieldCheckIcon, ShieldIcon } from '@primer/octicons-react'

// Selo de autoridade do autor, compartilhado entre o cabeçalho da publicação e os comentários
// (raiz, respostas, qualquer profundidade e a tela de conversa). Superadmin tem prioridade sobre
// administrador da comunidade -- nunca os dois ao mesmo tempo -- e usuário comum não recebe nada.
export function AuthorRoleBadge({ isSuperAdmin, isCommunityAdmin, className = '' }) {
  if (isSuperAdmin) {
    return (
      <span
        className={`author-role-badge author-role-badge--superadmin ${className}`.trim()}
        title="Superadmin"
        aria-label="Superadmin"
      >
        <ShieldCheckIcon size={14} />
      </span>
    )
  }
  if (isCommunityAdmin) {
    return (
      <span
        className={`author-role-badge author-role-badge--admin ${className}`.trim()}
        title="Administrador da comunidade"
        aria-label="Administrador da comunidade"
      >
        <ShieldIcon size={14} />
      </span>
    )
  }
  return null
}
