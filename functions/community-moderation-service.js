// Fase 5 (privilégios com EvoCash): caminho DEDICADO para banir/desbanir de UMA
// comunidade -- deliberadamente NÃO uma ampliação de decideSupportRequest (que também
// concede system_ban/temporary_suspension globais, warning e remove_content -- nada
// disso pode ficar acessível ao dono de uma comunidade). Só escreve/apaga
// communityRestrictions/{communityId}_{targetUserId} -- nunca accountRestrictions (esse
// continua exclusivamente global, só via decideSupportRequest).
//
// "Remover/expulsar membro" fica de fora de propósito: a auditoria da Fase 5 confirmou
// que essa capacidade não existe hoje nem para superadmin, então adicioná-la aqui seria
// inventar um recurso novo, não "adaptar o menor conjunto possível".
export function createCommunityModerationService({ db, FieldValue, HttpsError, isProtectedRole }) {
  async function requireSuperAdminOrCommunityOwner(uid, communityId) {
    const [admin, community] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      db.doc(`communities/${communityId}`).get(),
    ])
    const isSuperAdminCaller = admin.data()?.role === 'superadmin'
    if (isSuperAdminCaller) return { isSuperAdminCaller }
    if (community.exists && community.data().ownerId === uid) return { isSuperAdminCaller: false }
    throw new HttpsError(
      'permission-denied',
      'Apenas administradores ou o dono da comunidade podem executar esta ação.'
    )
  }

  // Política registrada (auditoria da Fase 5): community_ban aplicado pela moderação
  // GLOBAL (decideSupportRequest, com decisionId ligado a um moderationDecisions --
  // decisão formal, com evidência e recurso possível) nunca pode ser desfeito pelo
  // dono via este caminho leve. Só um superadmin desfaz uma decisão formal. Um
  // banimento que o PRÓPRIO dono aplicou por aqui (sem decisionId) continua livre para
  // ele desbanir a qualquer momento -- a restrição só protege decisões que vieram do
  // sistema de moderação formal, nunca as do dono sobre a própria comunidade.
  async function setCommunityMemberBan(adminId, { communityId, targetUserId, banned, reason }) {
    if (banned && (typeof reason !== 'string' || reason.trim().length < 5)) {
      throw new HttpsError('invalid-argument', 'Informe um motivo para o banimento.')
    }
    if (targetUserId === adminId) {
      throw new HttpsError('failed-precondition', 'Você não pode banir a si mesmo.')
    }
    const { isSuperAdminCaller } = await requireSuperAdminOrCommunityOwner(adminId, communityId)
    const ref = db.doc(`communityRestrictions/${communityId}_${targetUserId}`)
    if (banned) {
      const target = await db.doc(`users/${targetUserId}`).get()
      if (isProtectedRole(target.data()?.role)) {
        throw new HttpsError('failed-precondition', 'Não é possível banir um administrador.')
      }
      await ref.set({
        userId: targetUserId,
        communityId,
        bannedBy: adminId,
        reason: reason.trim(),
        createdAt: FieldValue.serverTimestamp(),
      })
    } else {
      if (!isSuperAdminCaller) {
        const existing = await ref.get()
        if (existing.exists && existing.data().decisionId) {
          throw new HttpsError(
            'permission-denied',
            'Este banimento foi aplicado pela moderação global e só pode ser revisto por um administrador.'
          )
        }
      }
      await ref.delete()
    }
    return { communityId, targetUserId, banned }
  }

  return { setCommunityMemberBan, requireSuperAdminOrCommunityOwner }
}
