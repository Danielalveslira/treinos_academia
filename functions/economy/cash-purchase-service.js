import { validId } from '../legal-core.js'
import {
  cashPurchaseIdFromRequest,
  isValidCashPackage,
  isValidPurchaseSnapshot,
  financialBlockReason,
  resolveConfigVersion,
} from './cash-purchase-core.js'

// Fase 4 (EvoCash) -- requestCashPurchase/confirmCashPurchase/cancelCashPurchase.
//
// cashPurchases/{purchaseId} é top-level (não users/{uid}/cashPurchases), espelhando
// supportRequests: o painel admin lista "compras pending" de todo mundo sem
// collection-group query. purchaseId é SEMPRE cashPurchaseIdFromRequest(uid, requestId)
// -- nunca um auto-id -- isso é o que torna requestCashPurchase idempotente (ver
// cash-purchase-core.js).
//
// users/{uid}/wallet/cashPurchaseLock guarda { pendingPurchaseId } -- sibling de
// wallet/current na MESMA subcoleção wallet, então herda a Rule existente
// (match /wallet/{docId}) sem precisar de nenhuma regra nova. É o mecanismo
// determinístico/atômico de "no máximo 1 pending por usuário" (leitura+escrita do MESMO
// documento, serializado pelo Firestore de verdade -- nunca uma query userId+status).
export function createCashPurchaseService({ db, FieldValue, wallet, ledger, assertWritableAccount, HttpsError }) {
  function purchaseRef(purchaseId) {
    return db.doc(`cashPurchases/${purchaseId}`)
  }
  function lockRef(uid) {
    return db.doc(`users/${uid}/wallet/cashPurchaseLock`)
  }
  function deletionJobRef(uid) {
    return db.doc(`deletionJobs/account_${uid}`)
  }

  function purchasePayload(purchaseId, data) {
    return {
      purchaseId,
      status: data.status,
      packageId: data.packageId,
      packageLabel: data.packageLabel,
      cashAmount: data.cashAmount,
      amountCentavos: data.amountCentavos,
      currency: data.currency,
    }
  }

  async function requestCashPurchase(uid, { packageId, requestId }) {
    if (!validId(packageId)) throw new HttpsError('invalid-argument', 'Pacote inválido.')
    if (!validId(requestId)) throw new HttpsError('invalid-argument', 'Requisição inválida.')
    const purchaseId = cashPurchaseIdFromRequest(uid, requestId)
    const ref = purchaseRef(purchaseId)

    return db.runTransaction(async (tx) => {
      const existing = await tx.get(ref)
      if (existing.exists) {
        const data = existing.data()
        // Reusar o mesmo requestId com um payload diferente (packageId trocado, ou de
        // outro uid -- impossível na prática já que o hash inclui uid, mas checado
        // mesmo assim) nunca devolve silenciosamente a compra ANTIGA como se fosse a
        // nova intenção -- falha explicitamente.
        if (data.userId !== uid || data.packageId !== packageId) {
          throw new HttpsError(
            'already-exists',
            'Este requestId já foi usado para uma compra diferente.'
          )
        }
        return purchasePayload(purchaseId, data)
      }

      await assertWritableAccount(tx, uid)

      const lockSnapshot = await tx.get(lockRef(uid))
      if (lockSnapshot.exists && lockSnapshot.data().pendingPurchaseId) {
        throw new HttpsError('failed-precondition', 'Você já tem uma compra de EvoCash pendente.')
      }

      // SEMPRE uma leitura fresca (tx.get direto, nunca getEconomyConfig() com cache) --
      // preço/ativação de pacote é a única parte da config econômica onde "ausente ou
      // inválida" precisa BLOQUEAR a operação, nunca cair num default embutido.
      const configSnapshot = await tx.get(db.doc('economyConfig/current'))
      const pkg = configSnapshot.exists ? configSnapshot.data()?.cashPackages?.[packageId] : null
      if (!isValidCashPackage(pkg)) {
        throw new HttpsError('failed-precondition', 'Pacote de EvoCash indisponível no momento.')
      }
      if (pkg.active !== true) {
        throw new HttpsError('failed-precondition', 'Este pacote não está mais disponível.')
      }

      const purchase = {
        userId: uid,
        packageId,
        packageLabel: pkg.label,
        cashAmount: pkg.cashAmount,
        amountCentavos: pkg.amountCentavos,
        currency: 'BRL',
        configVersion: resolveConfigVersion(configSnapshot.data().version),
        paymentMethod: 'manual_pix',
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      }
      tx.create(ref, purchase)
      tx.set(
        lockRef(uid),
        { pendingPurchaseId: purchaseId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      )
      return purchasePayload(purchaseId, purchase)
    })
  }

  // Libera um job de exclusão travado em 'blocked_financial_review' assim que a
  // pendência financeira que causou o bloqueio deixa de existir -- reaproveita
  // financialBlockReason com os valores HIPOTÉTICOS que a própria escrita em curso vai
  // produzir (nunca revalida lendo de novo depois de escrever: tudo dentro da MESMA
  // transação, reads já feitos antes desta chamada).
  function reactivateDeletionIfClear(tx, deletionJobSnapshot, uid, hypothetical) {
    if (!deletionJobSnapshot.exists || deletionJobSnapshot.data().state !== 'blocked_financial_review') {
      return
    }
    const reason = financialBlockReason(hypothetical)
    if (reason) {
      // Ainda bloqueado, mas talvez por um motivo DIFERENTE do que causou o bloqueio
      // original -- ex.: cancelar remove 'pending_cash_purchase', mas confirmar credita
      // EvoCash e produz 'positive_cash_balance' no lugar. Sempre refresca o motivo
      // relatado; nunca deixa um blockReason obsoleto para quem olha o painel admin.
      tx.update(deletionJobRef(uid), { blockReason: reason, updatedAt: FieldValue.serverTimestamp() })
      return
    }
    tx.update(deletionJobRef(uid), {
      state: 'pending',
      blockReason: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  async function confirmCashPurchase(adminId, purchaseId, adminNote) {
    if (!validId(purchaseId)) throw new HttpsError('invalid-argument', 'Compra inválida.')
    if (adminNote != null && (typeof adminNote !== 'string' || adminNote.length > 500)) {
      throw new HttpsError('invalid-argument', 'Nota inválida.')
    }
    const ref = purchaseRef(purchaseId)

    return db.runTransaction(async (tx) => {
      const [admin, purchase] = await tx.getAll(db.doc(`users/${adminId}`), ref)
      if (admin.data()?.role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Apenas administradores podem confirmar compras.')
      }
      if (!purchase.exists) throw new HttpsError('not-found', 'Compra não encontrada.')
      const data = purchase.data()
      if (data.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'Esta compra não está mais pendente.')
      }
      // Revalidação defensiva do snapshot já persistido -- nunca credita só porque o
      // documento existe e está 'pending'. Não deveria disparar dado o resto do desenho
      // (o snapshot só é escrito uma vez, por requestCashPurchase, já validado na
      // criação), mas dinheiro real não confia cegamente num dado só porque já está
      // gravado (edição manual, migração futura, bug em outro lugar).
      if (!isValidPurchaseSnapshot(data)) {
        throw new HttpsError('failed-precondition', 'Snapshot da compra inconsistente -- não é seguro creditar.')
      }

      const buyerUid = data.userId
      const naturalKey = `cash-purchase:${purchaseId}`
      const [walletSnapshot, lockSnapshot, deletionJobSnapshot] = await tx.getAll(
        wallet.walletRef(buyerUid),
        lockRef(buyerUid),
        deletionJobRef(buyerUid)
      )
      // Defesa extra além da guarda de status:'pending' acima (que já torna dupla
      // confirmação estruturalmente segura via serialização de transação do Firestore)
      // -- não deveria disparar dado o resto do desenho.
      if (await ledger.alreadyRecorded(tx, buyerUid, naturalKey)) {
        throw new HttpsError('failed-precondition', 'Esta compra já foi creditada.')
      }
      const currentWallet = walletSnapshot.exists
        ? walletSnapshot.data()
        : { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }
      const nextCashBalance = currentWallet.cashBalance + data.cashAmount

      // ---- escrita ----
      wallet.creditCash(tx, buyerUid, currentWallet, data.cashAmount)
      ledger.record(tx, buyerUid, naturalKey, {
        asset: 'cash',
        direction: 'credit',
        amount: data.cashAmount,
        reason: 'cash_purchase_confirmed',
        referenceType: 'cash_purchase',
        referenceId: purchaseId,
      })
      tx.update(ref, {
        status: 'credited',
        creditedAt: FieldValue.serverTimestamp(),
        creditedBy: adminId,
        // Nota livre para auditoria do PIX manual (ex.: referência/comprovante) --
        // metadado de transição, igual creditedBy/creditedAt. Nunca toca cashAmount/
        // amountCentavos/currency/packageId: nem é lido daqui, é um campo A MAIS no
        // mesmo tx.update, que já não referencia nenhum campo do snapshot financeiro.
        ...(adminNote ? { confirmationNote: adminNote.trim() } : {}),
      })
      if (lockSnapshot.exists && lockSnapshot.data().pendingPurchaseId === purchaseId) {
        tx.set(
          lockRef(buyerUid),
          { pendingPurchaseId: null, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
      }
      // Nota: confirmar quase sempre deixa cashBalance > 0, então um job travado por
      // 'positive_cash_balance' normalmente CONTINUA travado depois de um confirm --
      // esperado (Fase 4: cashBalance > 0 é bloqueador financeiro até existir decisão de
      // produto/jurídico sobre perda/reembolso, ver deletion-service.js).
      reactivateDeletionIfClear(tx, deletionJobSnapshot, buyerUid, {
        pendingPurchaseId: null,
        cashBalance: nextCashBalance,
      })
      return { purchaseId, cashAmount: data.cashAmount }
    })
  }

  async function cancelCashPurchase(adminId, purchaseId, reason) {
    if (!validId(purchaseId)) throw new HttpsError('invalid-argument', 'Compra inválida.')
    if (typeof reason !== 'string' || reason.trim().length < 5) {
      throw new HttpsError('invalid-argument', 'Informe um motivo para o cancelamento.')
    }
    const ref = purchaseRef(purchaseId)

    return db.runTransaction(async (tx) => {
      const [admin, purchase] = await tx.getAll(db.doc(`users/${adminId}`), ref)
      if (admin.data()?.role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Apenas administradores podem cancelar compras.')
      }
      if (!purchase.exists) throw new HttpsError('not-found', 'Compra não encontrada.')
      const data = purchase.data()
      if (data.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'Esta compra não está mais pendente.')
      }

      const buyerUid = data.userId
      const [walletSnapshot, lockSnapshot, deletionJobSnapshot] = await tx.getAll(
        wallet.walletRef(buyerUid),
        lockRef(buyerUid),
        deletionJobRef(buyerUid)
      )
      const currentCashBalance = walletSnapshot.exists ? walletSnapshot.data().cashBalance : 0

      // ---- escrita -- nenhum crédito foi dado ainda, então cancelar não reverte nada ----
      tx.update(ref, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: adminId,
        cancelReason: reason.trim(),
      })
      if (lockSnapshot.exists && lockSnapshot.data().pendingPurchaseId === purchaseId) {
        tx.set(
          lockRef(buyerUid),
          { pendingPurchaseId: null, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
      }
      reactivateDeletionIfClear(tx, deletionJobSnapshot, buyerUid, {
        pendingPurchaseId: null,
        cashBalance: currentCashBalance,
      })
      return { purchaseId }
    })
  }

  return { requestCashPurchase, confirmCashPurchase, cancelCashPurchase }
}
