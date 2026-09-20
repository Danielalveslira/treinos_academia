import { FieldPath } from 'firebase-admin/firestore'
import { validId } from '../legal-core.js'

// "Ver quem votou" -- listPostEconomyVoters (index.js). Nunca expõe
// statuses/{id}/economyVotes diretamente ao cliente (aqueles documentos têm campos
// internos da economia: charged, rewardState, rewardPendingAt/rewardDayKey/
// rewardRetryAt -- ver firestore.rules, que já restringe a leitura direta a
// isOwner(userId) || isSuperAdmin()), nem o documento completo de users/{uid}. Esta
// callable só devolve, por votante, exatamente {userId, username} -- o app não tem
// displayName nem foto de perfil hoje (username é o único identificador público, ver
// StatusCard.jsx/firestore.rules: users/{uid} não tem esses campos no schema atual).
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50

function sanitizeVoterProfile(userId, data) {
  return {
    userId,
    username: typeof data?.username === 'string' ? data.username : null,
  }
}

function resolvePageSize(limit) {
  return Number.isInteger(limit) && limit > 0 && limit <= MAX_PAGE_SIZE ? limit : DEFAULT_PAGE_SIZE
}

// Equivalente em Admin SDK de isSignedIn() + isMember(communityId, isSuperAdmin()) em
// firestore.rules (a mesma regra que decide quem pode LER statuses/{statusId}) --
// nunca mais permissiva nem mais estrita que ela. Pura/sem I/O: recebe os dados já
// lidos, decide, e devolve o PRIMEIRO motivo de bloqueio (nunca uma lista), mesmo
// padrão de createCommunityEligibilityReason (privilege-core.js). superadmin ignora
// TUDO abaixo -- é o "bypass apropriado apenas para superadmin" pedido na auditoria:
// um membro banido (communityRestriction) ou uma conta suspensa continuam bloqueados
// mesmo que o documento communityMembers ainda exista (a existência da filiação nunca
// basta sozinha).
export function resolvePostAccessDenialReason({
  isSuperAdmin,
  accountStatus,
  accountRestriction,
  nowMs,
  communityDeletionJobExists,
  communityRestrictionExists,
  isCommunityMember,
}) {
  if (isSuperAdmin) return null
  if (accountStatus === 'disabled') return 'account_disabled'
  if (accountRestriction) {
    const suspensionExpired =
      accountRestriction.action === 'temporary_suspension' &&
      typeof accountRestriction.untilMs === 'number' &&
      accountRestriction.untilMs <= nowMs
    if (!suspensionExpired) return 'account_restricted'
  }
  if (communityDeletionJobExists) return 'community_unavailable'
  if (communityRestrictionExists) return 'community_restricted'
  if (!isCommunityMember) return 'not_a_member'
  return null
}

// Custo aproximado de reads por página (pageSize=20, o padrão):
//   1  -- statuses/{statusId} (pega communityId para a checagem de acesso)
//   5  -- checagem de acesso, num único round-trip via db.getAll(): users/{uid} do
//         chamador (role/accountStatus), accountRestrictions/{uid},
//         deletionJobs/community_{communityId}, communityRestrictions/{communityId}_
//         {uid}, communityMembers/{communityId}_{uid} -- equivalente completo a
//         isSignedIn()+isMember() em firestore.rules, não só "é membro?".
//   até pageSize -- consulta paginada em economyVotes (1 round-trip, ~pageSize reads
//         cobrados, nunca N getDoc separados)
//   até pageSize -- db.getAll(...) dos perfis dos votantes da página (1 round-trip,
//         ~pageSize reads cobrados -- não dá pra evitar, cada perfil é um documento
//         distinto; o que se evita aqui é o número de IDAS AO SERVIDOR, não o número
//         de reads billados, mesmo raciocínio de getMyEconomyVotesForStatuses em
//         economyService.js)
// Total: ~2*pageSize + 6 reads -- para pageSize=20, isso é ~46 reads/página.
export function createListPostEconomyVoters({ db, Timestamp, HttpsError, now = Date.now }) {
  return async function listPostEconomyVoters(uid, { statusId, direction, cursor, limit }) {
    if (!validId(statusId)) throw new HttpsError('invalid-argument', 'Publicação inválida.')
    if (direction !== 'positive' && direction !== 'negative') {
      throw new HttpsError('invalid-argument', 'Direção inválida.')
    }
    const pageSize = resolvePageSize(limit)

    const statusSnapshot = await db.doc(`statuses/${statusId}`).get()
    if (!statusSnapshot.exists) throw new HttpsError('not-found', 'Publicação não encontrada.')
    const communityId = statusSnapshot.data().communityId

    const [callerSnapshot, accountRestrictionSnapshot, communityDeletionJobSnapshot, communityRestrictionSnapshot, membershipSnapshot] =
      await db.getAll(
        db.doc(`users/${uid}`),
        db.doc(`accountRestrictions/${uid}`),
        db.doc(`deletionJobs/community_${communityId}`),
        db.doc(`communityRestrictions/${communityId}_${uid}`),
        db.doc(`communityMembers/${communityId}_${uid}`)
      )

    const callerData = callerSnapshot.data() || {}
    const denialReason = resolvePostAccessDenialReason({
      isSuperAdmin: callerData.role === 'superadmin',
      accountStatus: callerData.accountStatus || 'active',
      accountRestriction: accountRestrictionSnapshot.exists
        ? {
            action: accountRestrictionSnapshot.data().action,
            untilMs: accountRestrictionSnapshot.data().until?.toMillis() ?? null,
          }
        : null,
      nowMs: now(),
      communityDeletionJobExists: communityDeletionJobSnapshot.exists,
      communityRestrictionExists: communityRestrictionSnapshot.exists,
      isCommunityMember: membershipSnapshot.exists,
    })
    if (denialReason) {
      throw new HttpsError('permission-denied', 'Você não tem acesso a esta publicação.')
    }

    // orderBy(FieldPath.documentId()) é o desempate explícito para firstChargedAt --
    // Firestore exige que os valores de startAfter batam exatamente com as cláusulas
    // orderBy() da consulta (não infere __name__ sozinho); o id do documento já É o
    // voterId (ver vote-service.js: statuses/{id}/economyVotes/{uid}), então não
    // precisa de nenhum campo extra indexado só para isto. firstChargedAt é sempre
    // gravado desde o primeiro voto (create) e nunca sobrescrito depois (switch/
    // remove preservam o valor original) -- todo voto ativo (value 1 ou -1) que pode
    // entrar nesta query sempre tem o campo, nunca fica de fora por falta dele.
    const value = direction === 'positive' ? 1 : -1
    let votesQuery = db
      .collection(`statuses/${statusId}/economyVotes`)
      .where('value', '==', value)
      .orderBy('firstChargedAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(pageSize)
    if (cursor != null && Number.isFinite(cursor.firstChargedAtMs) && typeof cursor.voterId === 'string') {
      votesQuery = votesQuery.startAfter(Timestamp.fromMillis(cursor.firstChargedAtMs), cursor.voterId)
    }
    const votesSnapshot = await votesQuery.get()

    const voterIds = votesSnapshot.docs.map((doc) => doc.id)
    const profileSnapshots = voterIds.length
      ? await db.getAll(...voterIds.map((voterId) => db.doc(`users/${voterId}`)))
      : []
    const profileByUserId = new Map(profileSnapshots.map((snapshot) => [snapshot.id, snapshot.data()]))
    const voters = voterIds.map((voterId) => sanitizeVoterProfile(voterId, profileByUserId.get(voterId)))

    const lastDoc = votesSnapshot.docs.at(-1)
    const nextCursor =
      votesSnapshot.size === pageSize && lastDoc
        ? { firstChargedAtMs: lastDoc.data().firstChargedAt.toMillis(), voterId: lastDoc.id }
        : null

    return { voters, nextCursor }
  }
}
