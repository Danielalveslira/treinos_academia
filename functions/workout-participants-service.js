import { FieldPath } from 'firebase-admin/firestore'
import { validId } from './legal-core.js'
import { resolvePostAccessDenialReason } from './economy/vote-query-service.js'

// "Ver participantes" (Treino Marcado V1) -- listWorkoutParticipants (index.js). Mesmo
// padrão de listPostEconomyVoters (economy/vote-query-service.js): nunca expõe
// statuses/{id}/participants/{uid} nem users/{uid} diretamente ao cliente (users/{uid}
// só é legível por isOwner/isSuperAdmin, ver firestore.rules) -- só devolve, por
// participante, {userId, username}. Reaproveita resolvePostAccessDenialReason (mesma
// checagem de acesso de "Ver quem votou": equivalente exato a
// isSignedIn()+isMember(communityId) em firestore.rules, nunca menos restrita), em vez
// de duplicar essa lógica de novo aqui.
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50

function sanitizeParticipant(userId, data) {
  return { userId, username: typeof data?.username === 'string' ? data.username : null }
}

function resolvePageSize(limit) {
  return Number.isInteger(limit) && limit > 0 && limit <= MAX_PAGE_SIZE ? limit : DEFAULT_PAGE_SIZE
}

// Custo aproximado por página (pageSize=20, o padrão): 1 (status) + 5 (checagem de
// acesso via db.getAll) + até pageSize (participantes) + até pageSize (perfis) -- mesma
// conta de listPostEconomyVoters, ~46 reads na primeira página.
export function createListWorkoutParticipants({ db, Timestamp, HttpsError, now = Date.now }) {
  return async function listWorkoutParticipants(uid, { statusId, cursor, limit }) {
    if (!validId(statusId)) throw new HttpsError('invalid-argument', 'Publicação inválida.')
    const pageSize = resolvePageSize(limit)

    const statusSnapshot = await db.doc(`statuses/${statusId}`).get()
    if (!statusSnapshot.exists) throw new HttpsError('not-found', 'Publicação não encontrada.')
    const status = statusSnapshot.data()
    if (status.type !== 'workout') {
      throw new HttpsError('failed-precondition', 'Esta publicação não é um treino marcado.')
    }
    const communityId = status.communityId

    const [
      callerSnapshot,
      accountRestrictionSnapshot,
      communityDeletionJobSnapshot,
      communityRestrictionSnapshot,
      membershipSnapshot,
    ] = await db.getAll(
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

    // orderBy(FieldPath.documentId()) desempata joinedAt -- o id do documento já É o
    // userId (ver joinWorkout em statusesService.js), então não precisa de nenhum campo
    // extra indexado só para isto (mesmo raciocínio de listPostEconomyVoters).
    let participantsQuery = db
      .collection(`statuses/${statusId}/participants`)
      .orderBy('joinedAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(pageSize)
    if (cursor != null && Number.isFinite(cursor.joinedAtMs) && typeof cursor.userId === 'string') {
      participantsQuery = participantsQuery.startAfter(
        Timestamp.fromMillis(cursor.joinedAtMs),
        cursor.userId
      )
    }
    const participantsSnapshot = await participantsQuery.get()

    const userIds = participantsSnapshot.docs.map((doc) => doc.id)
    const profileSnapshots = userIds.length
      ? await db.getAll(...userIds.map((userId) => db.doc(`users/${userId}`)))
      : []
    const profileByUserId = new Map(
      profileSnapshots.map((snapshot) => [snapshot.id, snapshot.data()])
    )
    const participants = userIds.map((userId) =>
      sanitizeParticipant(userId, profileByUserId.get(userId))
    )

    const lastDoc = participantsSnapshot.docs.at(-1)
    const nextCursor =
      participantsSnapshot.size === pageSize && lastDoc
        ? { joinedAtMs: lastDoc.data().joinedAt.toMillis(), userId: lastDoc.id }
        : null

    return { participants, nextCursor }
  }
}
