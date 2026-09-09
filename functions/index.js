import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import {
  legalDigest,
  requestIp,
  validateAcceptance,
  validateSupportRequest,
  validateDecision,
} from './legal-core.js'
import {
  computeNextPaymentDate,
  addBusinessDays,
  validateConfirmPayment,
  validateSetAccountStatus,
  validateDeleteAccount,
} from './billing-core.js'

initializeApp()
const db = getFirestore()
const authAdmin = getAuth()
const manifest = JSON.parse(readFileSync(new URL('./legal/manifest.json', import.meta.url)))
const documents = JSON.parse(readFileSync(new URL('./legal/documents.json', import.meta.url)))
const digest = legalDigest(manifest, documents)
const options = { region: 'southamerica-east1', maxInstances: 5 }
// Espelha DEFAULT_BILLING_CONFIG de src/utils/billing.js — o appConfig/billing só existe
// no Firestore depois que um SUPERADMIN salva algo pela primeira vez pelo painel admin;
// até lá, tanto o cliente quanto as functions usam este mesmo default.
const DEFAULT_BILLING = {
  trialDays: 3,
  graceBusinessDays: 1,
  plans: [
    { id: 'basico', name: 'Básico', price: 25.9, billingCycle: 'monthly' },
    { id: 'plus', name: 'Plus', price: 39.9, billingCycle: 'monthly' },
  ],
}

function requireUser(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entre na sua conta.')
  return request.auth.uid
}

async function requireSuperAdmin(uid) {
  const admin = await db.doc(`users/${uid}`).get()
  if (admin.data()?.role !== 'superadmin') {
    throw new HttpsError('permission-denied', 'Apenas administradores podem executar esta ação.')
  }
}

export const acceptLegalDocuments = onCall(options, async (request) => {
  const uid = requireUser(request)
  const error = validateAcceptance(request.data, manifest)
  if (error) throw new HttpsError('failed-precondition', error)
  let ip
  try {
    ip = requestIp(request)
  } catch {
    throw new HttpsError('internal', 'Não foi possível registrar o aceite. Tente novamente.')
  }
  const acceptance = db.doc(`users/${uid}/legalAcceptances/${manifest.version}`)
  const archive = db.doc(`legalVersions/${manifest.version}`)
  const profile = db.doc(`users/${uid}`)
  await db.runTransaction(async (tx) => {
    const [previous, version, user, policy] = await tx.getAll(
      acceptance,
      archive,
      profile,
      db.doc('legalPolicy/current')
    )
    if (!user.exists)
      throw new HttpsError('failed-precondition', 'Finalize seu perfil antes do aceite.')
    if (policy.data()?.version !== manifest.version || policy.data()?.digest !== digest) {
      throw new HttpsError(
        'failed-precondition',
        'Os documentos estão sendo atualizados. Tente novamente em instantes.'
      )
    }
    if (version.exists && version.data().digest !== digest) {
      throw new HttpsError('failed-precondition', 'Uma versão publicada não pode ser substituída.')
    }
    if (previous.exists) {
      if (previous.data().digest !== digest)
        throw new HttpsError('failed-precondition', 'Versão inconsistente.')
      return
    }
    if (!version.exists)
      tx.create(archive, { manifest, documents, digest, createdAt: FieldValue.serverTimestamp() })
    tx.create(acceptance, {
      userId: uid,
      version: manifest.version,
      digest,
      acceptedAt: FieldValue.serverTimestamp(),
      ip,
      accepted: true,
      healthDataConsent: true,
      ageConfirmed: true,
    })
    tx.update(profile, {
      legalAcceptance: {
        version: manifest.version,
        digest,
        acceptedAt: FieldValue.serverTimestamp(),
      },
    })
  })
  return { version: manifest.version }
})

export const submitSupportRequest = onCall(options, async (request) => {
  const uid = requireUser(request)
  const error = validateSupportRequest(request.data)
  if (error) throw new HttpsError('invalid-argument', error)
  const { kind, message, statusId = '', communityId = '', decisionId = '' } = request.data
  const ref = db.collection('supportRequests').doc()
  const throttle = db.doc(`supportLimits/${uid}`)
  await db.runTransaction(async (tx) => {
    const limit = await tx.get(throttle)
    const now = Date.now()
    if (limit.exists && now - limit.data().lastRequestAt.toMillis() < 60000) {
      throw new HttpsError('resource-exhausted', 'Aguarde um minuto antes de enviar outro pedido.')
    }
    let snapshot = null
    let relatedCommunity = communityId
    if (statusId && kind === 'report') {
      const status = await tx.get(db.doc(`statuses/${statusId}`))
      if (!status.exists)
        throw new HttpsError(
          'not-found',
          'A publicação não está mais disponível. Envie o relato sem a referência da publicação.'
        )
      relatedCommunity = status.data().communityId
      const membership = await tx.get(db.doc(`communityMembers/${relatedCommunity}_${uid}`))
      if (!membership.exists)
        throw new HttpsError('permission-denied', 'Você não tem acesso a essa publicação.')
      snapshot = status.data()
    }
    if (kind === 'appeal') {
      const decision = await tx.get(db.doc(`moderationDecisions/${decisionId}`))
      if (!decision.exists || decision.data().targetUserId !== uid)
        throw new HttpsError('permission-denied', 'Decisão não encontrada para sua conta.')
    }
    tx.create(ref, {
      userId: uid,
      kind,
      message: message.trim(),
      statusId: kind === 'report' ? statusId : '',
      communityId: relatedCommunity,
      decisionId: kind === 'appeal' ? decisionId : '',
      contentSnapshot: snapshot,
      state: 'open',
      createdAt: FieldValue.serverTimestamp(),
    })
    tx.set(throttle, { lastRequestAt: Timestamp.fromMillis(now) })
  })
  return { id: ref.id }
})

export const decideSupportRequest = onCall(options, async (request) => {
  const adminId = requireUser(request)
  const error = validateDecision(request.data)
  if (error) throw new HttpsError('invalid-argument', error)
  const {
    requestId,
    action,
    reason,
    rule,
    evidence,
    targetUserId = '',
    communityId = '',
    days,
  } = request.data
  const ref = db.doc(`supportRequests/${requestId}`)
  const decisionRef = db.collection('moderationDecisions').doc()
  await db.runTransaction(async (tx) => {
    const [admin, support] = await tx.getAll(db.doc(`users/${adminId}`), ref)
    if (admin.data()?.role !== 'superadmin')
      throw new HttpsError('permission-denied', 'Apenas administradores podem decidir.')
    if (!support.exists || support.data().state !== 'open')
      throw new HttpsError('failed-precondition', 'O pedido já foi concluído ou não existe.')
    const data = support.data()
    if (!['report', 'appeal'].includes(data.kind) && action !== 'no_action') {
      throw new HttpsError(
        'invalid-argument',
        'Pedidos de privacidade e cobrança não aplicam penalidades.'
      )
    }
    if (targetUserId) {
      const target = await tx.get(db.doc(`users/${targetUserId}`))
      if (!target.exists || target.data().role === 'superadmin' || targetUserId === adminId) {
        throw new HttpsError('failed-precondition', 'Usuário inválido para esta medida.')
      }
      const expectedTarget = data.contentSnapshot?.authorId
      if (expectedTarget && targetUserId !== expectedTarget)
        throw new HttpsError(
          'invalid-argument',
          'O usuário não corresponde à publicação denunciada.'
        )
      if (data.kind === 'appeal' && targetUserId !== data.userId)
        throw new HttpsError('invalid-argument', 'O recurso pertence a outro usuário.')
    }
    if (action === 'community_ban' && communityId !== data.communityId)
      throw new HttpsError('invalid-argument', 'Comunidade divergente.')
    if (action === 'remove_content' && !data.statusId)
      throw new HttpsError('invalid-argument', 'O pedido não contém uma publicação.')
    const until =
      action === 'temporary_suspension' ? Timestamp.fromMillis(Date.now() + days * 86400000) : null
    tx.create(decisionRef, {
      requestId,
      adminId,
      targetUserId,
      action,
      communityId,
      rule: rule.trim(),
      reason: reason.trim(),
      evidence: evidence.trim(),
      until,
      createdAt: FieldValue.serverTimestamp(),
    })
    tx.update(ref, {
      state: 'closed',
      response: reason.trim(),
      decisionId: decisionRef.id,
      decidedAt: FieldValue.serverTimestamp(),
    })
    if (targetUserId)
      tx.set(db.doc(`users/${targetUserId}/notices/${decisionRef.id}`), {
        action,
        rule: rule.trim(),
        reason: reason.trim(),
        communityId,
        until,
        createdAt: FieldValue.serverTimestamp(),
      })
    if (['temporary_suspension', 'system_ban'].includes(action)) {
      tx.set(db.doc(`accountRestrictions/${targetUserId}`), {
        action,
        until,
        decisionId: decisionRef.id,
      })
    }
    if (action === 'community_ban')
      tx.set(db.doc(`communityRestrictions/${communityId}_${targetUserId}`), {
        userId: targetUserId,
        communityId,
        decisionId: decisionRef.id,
      })
    if (action === 'restore') {
      if (communityId) tx.delete(db.doc(`communityRestrictions/${communityId}_${targetUserId}`))
      else tx.delete(db.doc(`accountRestrictions/${targetUserId}`))
    }
    if (action === 'remove_content') tx.delete(db.doc(`statuses/${data.statusId}`))
  })
  return { id: decisionRef.id }
})

// O transporte do onCall serializa objetos genéricos em JSON simples, então um Timestamp
// do Admin SDK não chega ao cliente como o Timestamp do SDK web (com .toMillis()) — vira
// ISO string aqui para que utils/billing.js leia igual em qualquer origem dos dados.
function serializeTimestamps(value) {
  if (value?.toDate) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serializeTimestamps)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeTimestamps(v)]))
  }
  return value
}

// E-mail só existe no Authentication, não no Firestore — o painel admin precisa dele
// para identificar contas (o @usuário pode ainda não ter sido definido).
export const listAccountsForAdmin = onCall(options, async (request) => {
  const adminId = requireUser(request)
  await requireSuperAdmin(adminId)
  const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get()
  const accounts = await Promise.all(
    snapshot.docs.map(async (docSnap) => {
      let email = null
      try {
        email = (await authAdmin.getUser(docSnap.id)).email ?? null
      } catch {
        email = null
      }
      return { id: docSnap.id, ...serializeTimestamps(docSnap.data()), email }
    })
  )
  return { accounts }
})

// Concede o trial uma única vez, com carimbos do servidor (nunca o relógio do
// dispositivo). Idempotente: chamadas repetidas após o cadastro não reiniciam o trial.
export const initializeTrial = onCall(options, async (request) => {
  const uid = requireUser(request)
  const ref = db.doc(`users/${uid}`)
  const config = await db.doc('appConfig/billing').get()
  const trialDays = config.data()?.trialDays ?? DEFAULT_BILLING.trialDays
  await db.runTransaction(async (tx) => {
    const user = await tx.get(ref)
    if (!user.exists) throw new HttpsError('failed-precondition', 'Finalize seu cadastro antes.')
    if (user.data().subscription) return
    tx.update(ref, {
      accountStatus: 'active',
      subscription: {
        planId: null,
        trialStartedAt: FieldValue.serverTimestamp(),
        trialEndsAt: Timestamp.fromMillis(Date.now() + trialDays * 86400000),
        billingCycle: 'monthly',
        billingAnchorDay: null,
        paidAt: null,
        lastPaymentConfirmedAt: null,
        nextPaymentAt: null,
        graceEndsAt: null,
        blockedAt: null,
        confirmedBy: null,
      },
    })
  })
  return { ok: true }
})

// Único ponto que ativa/renova uma assinatura — só o SUPERADMIN confirma, após checar
// o comprovante enviado por fora (WhatsApp). Preserva o billingAnchorDay entre renovações.
export const confirmPayment = onCall(options, async (request) => {
  const adminId = requireUser(request)
  const error = validateConfirmPayment(request.data)
  if (error) throw new HttpsError('invalid-argument', error)
  const { userId, planId } = request.data
  const userRef = db.doc(`users/${userId}`)
  const paymentRef = db.collection('payments').doc()
  await db.runTransaction(async (tx) => {
    const [admin, user, config] = await tx.getAll(
      db.doc(`users/${adminId}`),
      userRef,
      db.doc('appConfig/billing')
    )
    if (admin.data()?.role !== 'superadmin') {
      throw new HttpsError('permission-denied', 'Apenas administradores podem confirmar pagamentos.')
    }
    if (!user.exists) throw new HttpsError('not-found', 'Conta não encontrada.')
    const plan = (config.data()?.plans || DEFAULT_BILLING.plans).find((p) => p.id === planId)
    if (!plan) throw new HttpsError('invalid-argument', 'Plano não encontrado na configuração atual.')
    const graceBusinessDays = config.data()?.graceBusinessDays ?? DEFAULT_BILLING.graceBusinessDays
    const now = Date.now()
    const subscription = user.data().subscription || {}
    const anchorDay = subscription.billingAnchorDay ?? new Date(now).getUTCDate()
    // Pagamento adiantado não deve "roubar" dias do ciclo seguinte: se o vencimento
    // anterior ainda está no futuro, o próximo ciclo conta a partir dele, não de agora.
    const previousNext = subscription.nextPaymentAt?.toMillis?.()
    const anchorFrom = previousNext && previousNext > now ? previousNext : now
    const nextPaymentAtMillis = computeNextPaymentDate(anchorFrom, anchorDay)
    const graceEndsAtMillis = addBusinessDays(nextPaymentAtMillis, graceBusinessDays)
    tx.update(userRef, {
      accountStatus: 'active',
      subscription: {
        ...subscription,
        planId,
        billingAnchorDay: anchorDay,
        paidAt: FieldValue.serverTimestamp(),
        lastPaymentConfirmedAt: FieldValue.serverTimestamp(),
        nextPaymentAt: Timestamp.fromMillis(nextPaymentAtMillis),
        graceEndsAt: Timestamp.fromMillis(graceEndsAtMillis),
        blockedAt: null,
        confirmedBy: adminId,
      },
    })
    tx.create(paymentRef, {
      userId,
      planId,
      amount: plan.price,
      method: 'pix',
      status: 'confirmed',
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: adminId,
      referenceDueDate: Timestamp.fromMillis(nextPaymentAtMillis),
    })
  })
  return { id: paymentRef.id }
})

// Ativar/desativar é um estado administrativo separado do estado de assinatura (ver
// firestore.rules: hasAppAccess exige os dois). Desativar sempre exige um motivo.
export const setAccountStatus = onCall(options, async (request) => {
  const adminId = requireUser(request)
  const error = validateSetAccountStatus(request.data)
  if (error) throw new HttpsError('invalid-argument', error)
  const { userId, disabled, reason = '' } = request.data
  const userRef = db.doc(`users/${userId}`)
  await db.runTransaction(async (tx) => {
    const [admin, user] = await tx.getAll(db.doc(`users/${adminId}`), userRef)
    if (admin.data()?.role !== 'superadmin') {
      throw new HttpsError('permission-denied', 'Apenas administradores podem alterar contas.')
    }
    if (!user.exists) throw new HttpsError('not-found', 'Conta não encontrada.')
    if (user.data().role === 'superadmin') {
      throw new HttpsError('failed-precondition', 'Não é possível desativar outro administrador.')
    }
    tx.update(
      userRef,
      disabled
        ? {
            accountStatus: 'disabled',
            disabledAt: FieldValue.serverTimestamp(),
            disabledBy: adminId,
            disabledReason: reason.trim(),
          }
        : { accountStatus: 'active', disabledAt: null, disabledBy: null, disabledReason: null }
    )
  })
  return { ok: true }
})

// Exclusão permanente: operação crítica, só pelo SUPERADMIN, nunca resolvida
// apenas no frontend. Remove a conta da autenticação e todos os dados relacionados
// mapeados nas regras (subcoleções de users/ e publicProfiles/, reserva de @usuário,
// restrições, filiações a comunidades e publicações do próprio usuário) para não
// deixar documentos órfãos. Histórico financeiro (payments) é preservado por exigência
// contábil, como decisões de moderação — mesma lógica já aplicada a esses registros.
export const deleteAccountPermanently = onCall(options, async (request) => {
  const adminId = requireUser(request)
  const error = validateDeleteAccount(request.data)
  if (error) throw new HttpsError('invalid-argument', error)
  const { userId } = request.data
  if (userId === adminId) {
    throw new HttpsError('failed-precondition', 'Você não pode excluir a própria conta.')
  }
  await requireSuperAdmin(adminId)
  const userRef = db.doc(`users/${userId}`)
  const userSnap = await userRef.get()
  if (!userSnap.exists) throw new HttpsError('not-found', 'Conta não encontrada.')
  if (userSnap.data().role === 'superadmin') {
    throw new HttpsError('failed-precondition', 'Não é possível excluir outro administrador.')
  }

  const username = userSnap.data().username
  const batch = db.batch()
  if (username) batch.delete(db.doc(`usernames/${username}`))
  batch.delete(db.doc(`accountRestrictions/${userId}`))
  batch.delete(db.doc(`supportLimits/${userId}`))
  await batch.commit()

  const [memberships, statuses] = await Promise.all([
    db.collection('communityMembers').where('userId', '==', userId).get(),
    db.collection('statuses').where('authorId', '==', userId).get(),
  ])
  await Promise.all(memberships.docs.map((doc) => db.recursiveDelete(doc.ref)))
  await Promise.all(statuses.docs.map((doc) => db.recursiveDelete(doc.ref)))
  await db.recursiveDelete(db.doc(`publicProfiles/${userId}`))
  await db.recursiveDelete(userRef)

  try {
    await authAdmin.deleteUser(userId)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
  }

  return { ok: true }
})
