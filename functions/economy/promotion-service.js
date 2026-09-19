import { validId } from '../legal-core.js'
import { resolveConfigVersion } from './cash-purchase-core.js'
import {
  createPromotionIdFromRequest,
  isValidPromotionPackage,
  promotionInputMatches,
  resolvePromotionBlockReason,
  computePromotionExpiryMs,
  isTargetCurrentlyPromoted,
  promotionMatchesTarget,
  isPromotionCurrentlyActive,
  PROMOTION_TARGET_TYPES,
} from './promotion-core.js'

const REASON_ERRORS = {
  target_not_found: ['not-found', 'Publicação ou comunidade não encontrada.'],
  not_owner: ['permission-denied', 'Você não pode promover este conteúdo.'],
  account_disabled: ['permission-denied', 'Sua conta não está em condições de criar uma promoção.'],
  account_restricted: ['permission-denied', 'Sua conta está com uma restrição ativa.'],
  not_a_member: ['permission-denied', 'Você não participa mais desta comunidade.'],
  community_restricted: ['permission-denied', 'Você está impedido de interagir nesta comunidade.'],
  community_unavailable: ['failed-precondition', 'Esta comunidade não está disponível no momento.'],
  already_promoted: ['failed-precondition', 'Este conteúdo já está em uma promoção ativa.'],
  invalid_package: ['failed-precondition', 'Pacote de promoção indisponível no momento.'],
  insufficient_cash: ['failed-precondition', 'Você não tem EvoCash suficiente.'],
}

function targetCollection(targetType) {
  return targetType === 'post' ? 'statuses' : 'communities'
}

function promotionPayload(promotionId, data) {
  return {
    promotionId,
    status: data.status,
    targetType: data.targetType,
    targetId: data.targetId,
    packageId: data.packageId,
    cashAmount: data.cashAmount,
    durationDays: data.durationDays,
    expiresAtMs: data.expiresAt.toMillis(),
  }
}

// Fase 6 (promoções pagas com EvoCash) -- createPromotion/cancelPromotion/
// recordPromotionEvent/markTargetRemoved. Mesmo esqueleto de createCommunityWithCash
// (privilege-service.js): elegibilidade + débito + criação atômicos numa ÚNICA
// transação -- se qualquer checagem falhar, a função lança ANTES de qualquer escrita
// (nada é gravado); se tudo passa, ledger + promotions/{id} + o flag no alvo nascem
// juntos, na mesma transação. Nunca toca em sponsoredAds -- coleção, Rules e telas
// completamente separadas (ver auditoria da Fase 6).
export function createPromotionService({ db, FieldValue, Timestamp, wallet, ledger, assertWritableAccount, HttpsError, now = Date.now }) {
  function promotionRef(promotionId) {
    return db.doc(`promotions/${promotionId}`)
  }

  async function createPromotion(uid, { targetType, targetId, packageId, requestId }) {
    if (!PROMOTION_TARGET_TYPES.includes(targetType)) {
      throw new HttpsError('invalid-argument', 'Tipo de alvo inválido.')
    }
    if (!validId(targetId)) throw new HttpsError('invalid-argument', 'Alvo inválido.')
    if (!validId(packageId)) throw new HttpsError('invalid-argument', 'Pacote inválido.')
    if (!validId(requestId)) throw new HttpsError('invalid-argument', 'Requisição inválida.')

    const promotionId = createPromotionIdFromRequest(uid, requestId)
    const ref = promotionRef(promotionId)

    return db.runTransaction(async (tx) => {
      const existing = await tx.get(ref)
      if (existing.exists) {
        const data = existing.data()
        if (data.ownerId !== uid || !promotionInputMatches(data, { targetType, targetId, packageId })) {
          throw new HttpsError('already-exists', 'Este requestId já foi usado para uma promoção diferente.')
        }
        return promotionPayload(promotionId, data)
      }

      await assertWritableAccount(tx, uid)

      const targetRef = db.doc(`${targetCollection(targetType)}/${targetId}`)
      const [targetSnapshot, callerSnapshot, accountRestrictionSnapshot, configSnapshot] = await tx.getAll(
        targetRef,
        db.doc(`users/${uid}`),
        db.doc(`accountRestrictions/${uid}`),
        db.doc('economyConfig/current')
      )

      const targetExists = targetSnapshot.exists
      const targetData = targetExists ? targetSnapshot.data() : {}
      const communityId = targetExists ? (targetType === 'post' ? targetData.communityId : targetId) : null

      // Segunda rodada de leituras: só dá pra saber os refs de comunidade (e a própria
      // filiação/restrição do AUTOR nela) depois de ler o alvo primeiro. Ainda tudo
      // antes de qualquer escrita -- Firestore exige todas as leituras de uma transação
      // primeiro. Checa membership/communityRestrictions do autor mesmo pra promoção de
      // COMUNIDADE (o dono sempre ganha a própria filiação na criação, ver
      // privilege-service.js -- isto nunca bloqueia o caso comum, só quem realmente
      // saiu/foi banido).
      const [communitySnapshot, communityDeletionJobSnapshot, membershipSnapshot, communityRestrictionSnapshot] =
        targetExists
          ? await tx.getAll(
              targetType === 'community' ? targetRef : db.doc(`communities/${communityId}`),
              db.doc(`deletionJobs/community_${communityId}`),
              db.doc(`communityMembers/${communityId}_${uid}`),
              db.doc(`communityRestrictions/${communityId}_${uid}`)
            )
          : [null, null, null, null]

      const currentWallet = await wallet.getWallet(tx, uid)
      const callerData = callerSnapshot.data() || {}
      const config = configSnapshot.exists ? configSnapshot.data() : null
      const pkg = config?.promotionPackages?.[packageId]

      const isOwner =
        targetExists && (targetType === 'post' ? targetData.authorId === uid : targetData.ownerId === uid)

      const reason = resolvePromotionBlockReason({
        targetExists,
        isOwner,
        accountStatus: callerData.accountStatus || 'active',
        accountRestriction: accountRestrictionSnapshot.exists
          ? {
              action: accountRestrictionSnapshot.data().action,
              untilMs: accountRestrictionSnapshot.data().until?.toMillis() ?? null,
            }
          : null,
        nowMs: now(),
        isCurrentMember: membershipSnapshot?.exists ?? false,
        communityMembershipRestrictionExists: communityRestrictionSnapshot?.exists ?? false,
        communityDeletionJobExists: communityDeletionJobSnapshot?.exists ?? false,
        communityIsActive: communitySnapshot?.exists ? communitySnapshot.data().isActive !== false : false,
        targetAlreadyPromoted: isTargetCurrentlyPromoted(
          { promoted: targetData.promoted, promotedUntilMs: targetData.promotedUntil?.toMillis() ?? null },
          now()
        ),
        packageValid: isValidPromotionPackage(pkg) && pkg?.active === true,
        packageTargetTypeMatches: pkg?.targetType === targetType,
        cashBalance: currentWallet.cashBalance,
        cashCost: pkg?.cashAmount ?? Number.MAX_SAFE_INTEGER,
      })
      if (reason) {
        const [code, message] = REASON_ERRORS[reason]
        throw new HttpsError(code, message)
      }

      const naturalKey = `promote:${promotionId}`
      if (await ledger.alreadyRecorded(tx, uid, naturalKey)) {
        throw new HttpsError('failed-precondition', 'Esta promoção já foi cobrada.')
      }

      // ---- escrita -- tudo atômico: se algo acima lançou, nada disto é alcançado ----
      const nowMs = now()
      const expiresAtMs = computePromotionExpiryMs(nowMs, pkg.durationDays)
      wallet.debitCash(tx, uid, currentWallet, pkg.cashAmount)
      ledger.record(tx, uid, naturalKey, {
        asset: 'cash',
        direction: 'debit',
        amount: pkg.cashAmount,
        reason: 'promotion_purchase',
        referenceType: 'promotion',
        referenceId: promotionId,
      })
      const promotionData = {
        ownerId: uid,
        targetType,
        targetId,
        communityId,
        packageId,
        cashAmount: pkg.cashAmount,
        durationDays: pkg.durationDays,
        configVersion: resolveConfigVersion(config?.version),
        status: 'active',
        startedAt: Timestamp.fromMillis(nowMs),
        expiresAt: Timestamp.fromMillis(expiresAtMs),
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        clickCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      }
      tx.create(ref, promotionData)
      // activePromotionId: sem isto não existe caminho determinístico pra descobrir QUAL
      // promoção incrementar a partir de um card no feed (o card só vê promoted/
      // promotedUntil) -- recordPromotionEvent revalida tudo de novo antes de
      // incrementar (nunca confia neste campo sozinho, ver isPromotionCurrentlyActive/
      // promotionMatchesTarget). Server-managed, protegido contra escrita direta do
      // cliente (ver firestore.rules: isValidCommunity + allow update).
      tx.update(targetRef, {
        promoted: true,
        promotedUntil: Timestamp.fromMillis(expiresAtMs),
        activePromotionId: promotionId,
      })

      return promotionPayload(promotionId, promotionData)
    })
  }

  // Dono cancela sem precisar justificar (decisão própria); superadmin moderando a
  // promoção de outra pessoa precisa de motivo (mesmo mínimo de 5 caracteres já usado
  // em cancelCashPurchase/setCommunityMemberBan). Nunca reembolsa -- o EvoCash já foi
  // gasto atomicamente na criação, não existe estado "pendente" a desfazer.
  async function cancelPromotion(actorUid, { promotionId, reason }) {
    if (!validId(promotionId)) throw new HttpsError('invalid-argument', 'Promoção inválida.')

    return db.runTransaction(async (tx) => {
      const ref = promotionRef(promotionId)
      const [actorSnapshot, promotionSnapshot] = await tx.getAll(db.doc(`users/${actorUid}`), ref)
      if (!promotionSnapshot.exists) throw new HttpsError('not-found', 'Promoção não encontrada.')
      const promotion = promotionSnapshot.data()
      const isOwner = promotion.ownerId === actorUid
      const isSuperAdmin = actorSnapshot.data()?.role === 'superadmin'
      if (!isOwner && !isSuperAdmin) {
        throw new HttpsError('permission-denied', 'Você não pode cancelar esta promoção.')
      }
      if (!isOwner && (typeof reason !== 'string' || reason.trim().length < 5)) {
        throw new HttpsError('invalid-argument', 'Informe um motivo para o cancelamento.')
      }
      if (promotion.status !== 'active') {
        throw new HttpsError('failed-precondition', 'Esta promoção não está mais ativa.')
      }

      const targetRef = db.doc(`${targetCollection(promotion.targetType)}/${promotion.targetId}`)
      tx.update(ref, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: actorUid,
        cancelReason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
      })
      tx.update(targetRef, { promoted: false, promotedUntil: null, activePromotionId: null })
      return { promotionId }
    })
  }

  // "Métricas informativas" (App Check ainda adiado) -- só o contador agregado, nenhum
  // histórico individual. V1 só registra clique (ver auditoria: impressão dispararia a
  // cada render/scroll, volume de writes muito maior que o de cliques reais).
  //
  // targetType/targetId vêm do card que disparou o evento (o mesmo de onde o cliente
  // leu activePromotionId) -- revalida que a promoção realmente corresponde a ESTE
  // alvo e ainda está ativa/não expirada antes de incrementar, nunca confia cegamente
  // no ID vindo do cliente (um activePromotionId em cache/desatualizado não deveria
  // conseguir incrementar uma promoção errada, nem uma já encerrada).
  async function recordPromotionEvent(uid, { targetType, targetId, promotionId, type }) {
    if (!PROMOTION_TARGET_TYPES.includes(targetType)) {
      throw new HttpsError('invalid-argument', 'Tipo de alvo inválido.')
    }
    if (!validId(targetId)) throw new HttpsError('invalid-argument', 'Alvo inválido.')
    if (!validId(promotionId)) throw new HttpsError('invalid-argument', 'Promoção inválida.')
    if (type !== 'click') throw new HttpsError('invalid-argument', 'Tipo de evento inválido.')

    const ref = promotionRef(promotionId)
    const snapshot = await ref.get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Promoção não encontrada.')
    const promotion = snapshot.data()
    if (!promotionMatchesTarget(promotion, { targetType, targetId })) {
      throw new HttpsError('failed-precondition', 'Esta promoção não corresponde a este conteúdo.')
    }
    if (!isPromotionCurrentlyActive({ status: promotion.status, expiresAtMs: promotion.expiresAt?.toMillis() }, now())) {
      throw new HttpsError('failed-precondition', 'Esta promoção não está mais ativa.')
    }

    await ref.update({ clickCount: FieldValue.increment(1) })
    return { recorded: true }
  }

  // Chamado pelos gatilhos de exclusão de statuses/communities (index.js) -- nunca
  // apaga promotions/{id} (é histórico econômico real, mesmo tratamento que
  // cashPurchases/economyTransactions já recebem em deletion-service.js), só fecha o
  // estado como 'target_removed' (distinto de 'cancelled' -- ninguém cancelou, o alvo
  // sumiu). Idempotente: rodar de novo depois de já fechado é um no-op.
  async function markTargetRemoved(targetType, targetId) {
    const snapshot = await db
      .collection('promotions')
      .where('targetType', '==', targetType)
      .where('targetId', '==', targetId)
      .where('status', '==', 'active')
      .limit(5)
      .get()
    if (snapshot.empty) return
    await Promise.all(
      snapshot.docs.map((doc) =>
        db.runTransaction(async (tx) => {
          const current = await tx.get(doc.ref)
          if (current.data()?.status !== 'active') return
          tx.update(doc.ref, {
            status: 'target_removed',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledBy: null,
            cancelReason: 'Alvo removido.',
          })
        })
      )
    )
  }

  return { createPromotion, cancelPromotion, recordPromotionEvent, markTargetRemoved }
}
