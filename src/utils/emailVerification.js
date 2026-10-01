// Data de corte: só contas cujo perfil foi criado a partir daqui exigem e-mail
// verificado para acessar o sistema (ver EmailVerificationGate.jsx). Decisão de produto:
// não é retroativo — quem já tinha conta antes dessa mudança continua entrando
// normalmente, sem aviso nem bloqueio surpresa.
//
// Usa o createdAt já gravado no perfil (public.users.created_at), não
// user.metadata.creationTime do Auth. Hoje essa exigência só existe no cliente — não há
// policy/trigger no Postgres replicando este corte no servidor (mailer_autoconfirm está
// ligado no projeto; a política de verificação de e-mail foi adiada, ver
// docs/MIGRACAO_SUPABASE_STATUS.md).
export const EMAIL_VERIFICATION_CUTOFF = new Date('2026-09-11T14:15:00Z') // 1789136100000

export function requiresEmailVerification(profile) {
  const createdAt = profile?.createdAt?.toDate ? profile.createdAt.toDate() : null
  return !!createdAt && createdAt >= EMAIL_VERIFICATION_CUTOFF
}
