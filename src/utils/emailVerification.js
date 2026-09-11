// Data de corte: só contas cujo perfil foi criado a partir daqui exigem e-mail
// verificado para acessar o sistema (ver EmailVerificationGate.jsx e firestore.rules).
// Decisão de produto: não é retroativo — quem já tinha conta antes dessa mudança
// continua entrando normalmente, sem aviso nem bloqueio surpresa.
//
// Usa o createdAt já gravado no perfil (users/{uid}.createdAt), não
// user.metadata.creationTime do Authentication — precisa ser a mesma fonte lida pelo
// cliente (aqui) e pelas Security Rules (que não enxergam metadata do Authentication,
// só o que está no próprio documento Firestore), senão as duas camadas podem divergir
// sobre quem precisa verificar.
export const EMAIL_VERIFICATION_CUTOFF = new Date('2026-09-12T00:00:00Z')

export function requiresEmailVerification(profile) {
  const createdAt = profile?.createdAt?.toDate ? profile.createdAt.toDate() : null
  return !!createdAt && createdAt >= EMAIL_VERIFICATION_CUTOFF
}
