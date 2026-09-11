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
// Se mudar, atualize também firestore.rules (emailVerifiedOk), que usa o mesmo instante
// em milissegundos (timestamp.value(...) lá, .getTime() aqui) — timestamp.date() nas
// regras só tem granularidade de dia, então precisamos do valor exato dos dois lados
// pra não abrir uma janela onde cliente e servidor discordam sobre quem já foi pego
// pela exigência.
export const EMAIL_VERIFICATION_CUTOFF = new Date('2026-09-11T14:15:00Z') // 1789136100000

export function requiresEmailVerification(profile) {
  const createdAt = profile?.createdAt?.toDate ? profile.createdAt.toDate() : null
  return !!createdAt && createdAt >= EMAIL_VERIFICATION_CUTOFF
}
