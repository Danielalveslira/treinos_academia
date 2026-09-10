import { createAccountsService } from './accounts-service.js'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentCreated, onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { createDeletionService, statusPhotoExtra } from './deletion-service.js'
import { validId } from './legal-core.js'
import { accountView } from './admin-core.js'
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import {
  legalDigest,
  requestIp,
  validateAcceptance,
  validateSupportRequest,
  validateDecision,
} from './legal-core.js'
import {
  isProtectedRole,
  isSelfReport,
  REPORT_PROTECTED_AUTHOR_ERROR,
  REPORT_OWN_STATUS_ERROR,
} from './moderation-core.js'
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
// getStorage().bucket() precisa que o app tenha um bucket padrão resolvível, o que
// não é verdade em todo ambiente que importa este módulo (ex.: os testes de
// tests/admin-rules.test.mjs, que rodam fora do runtime real das Cloud Functions e
// nunca chegam a mexer com fotos). Resolver só na hora do uso evita quebrar esses
// ambientes por causa de um recurso que eles nunca exercitam.
const bucket = {
  file: (path) => getStorage().bucket().file(path),
  getFiles: (query) => getStorage().bucket().getFiles(query),
}
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

async function assertWritableAccount(tx, uid) {
  if ((await tx.get(db.doc(`deletionJobs/account_${uid}`))).exists) {
    throw new HttpsError('failed-precondition', 'A conta está em exclusão.')
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
    await assertWritableAccount(tx, uid)
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
    await assertWritableAccount(tx, uid)
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
      // Quem publicou já pode excluir a própria publicação diretamente — denunciá-la
      // não é uma denúncia de verdade. Checado antes do papel do autor de propósito:
      // evita uma leitura extra em users/ quando já dá pra recusar só com o statusId.
      if (isSelfReport(status.data().authorId, uid)) {
        throw new HttpsError('permission-denied', REPORT_OWN_STATUS_ERROR)
      }
      // O papel do autor é sempre conferido agora, na fonte (users/{authorId}), nunca
      // no selo authorIsSuperAdmin gravado na publicação — isso vale mesmo que o
      // pedido não tenha vindo do botão "Denunciar" (alguém chamando a function
      // direto com um statusId manipulado cai na mesma checagem).
      const author = await tx.get(db.doc(`users/${status.data().authorId}`))
      if (isProtectedRole(author.data()?.role)) {
        throw new HttpsError('permission-denied', REPORT_PROTECTED_AUTHOR_ERROR)
      }
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

// Só o autor cancela, e só enquanto o pedido segue aberto — depois de decidido,
// o histórico (e a eventual medida já aplicada) fica intacto.
export const cancelSupportRequest = onCall(options, async (request) => {
  const uid = requireUser(request)
  const requestId = request.data?.requestId
  if (!validId(requestId)) throw new HttpsError('invalid-argument', 'Pedido inválido.')
  const ref = db.doc(`supportRequests/${requestId}`)
  await db.runTransaction(async (tx) => {
    const support = await tx.get(ref)
    if (!support.exists || support.data().userId !== uid)
      throw new HttpsError('not-found', 'Pedido não encontrado.')
    if (support.data().state !== 'open')
      throw new HttpsError('failed-precondition', 'Este pedido já foi concluído.')
    tx.update(ref, {
      state: 'closed',
      response: 'Cancelado pelo usuário.',
      decidedAt: FieldValue.serverTimestamp(),
    })
  })
  return { ok: true }
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
    if (communityId && (await tx.get(db.doc(`deletionJobs/community_${communityId}`))).exists) {
      throw new HttpsError('failed-precondition', 'A comunidade está em exclusão.')
    }
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
      await assertWritableAccount(tx, targetUserId)
      const target = await tx.get(db.doc(`users/${targetUserId}`))
      if (!target.exists || isProtectedRole(target.data()?.role) || targetUserId === adminId) {
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

const accountsService = createAccountsService({ db, auth: authAdmin, FieldPath, HttpsError })
export const listAccountsForAdmin = onCall(options, async (request) => {
  await requireSuperAdmin(requireUser(request))
  return accountsService(request.data || {})
})

// Concede o trial uma única vez, com carimbos do servidor (nunca o relógio do
// dispositivo). Idempotente: chamadas repetidas após o cadastro não reiniciam o trial.
export const initializeTrial = onCall(options, async (request) => {
  const uid = requireUser(request)
  const ref = db.doc(`users/${uid}`)
  const config = await db.doc('appConfig/billing').get()
  const trialDays = config.data()?.trialDays ?? DEFAULT_BILLING.trialDays
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365)
    throw new HttpsError('failed-precondition', 'Configuração de trial inválida.')
  await db.runTransaction(async (tx) => {
    await assertWritableAccount(tx, uid)
    const user = await tx.get(ref)
    if (!user.exists) throw new HttpsError('failed-precondition', 'Finalize seu cadastro antes.')
    if (user.data().subscription) return
    tx.update(ref, {
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
  const { userId, planId, operationId } = request.data
  const userRef = db.doc(`users/${userId}`)
  const paymentRef = db.doc(`payments/${operationId}`)
  await db.runTransaction(async (tx) => {
    await assertWritableAccount(tx, userId)
    const [admin, user, plansDoc, config, previousPayment] = await tx.getAll(
      db.doc(`users/${adminId}`),
      userRef,
      db.doc('appConfig/plans'),
      db.doc('appConfig/billing'),
      paymentRef
    )
    if (admin.data()?.role !== 'superadmin') {
      throw new HttpsError(
        'permission-denied',
        'Apenas administradores podem confirmar pagamentos.'
      )
    }
    if (!user.exists) throw new HttpsError('not-found', 'Conta não encontrada.')
    if (previousPayment.exists) {
      const previous = previousPayment.data()
      if (
        previous.userId !== userId ||
        previous.planId !== planId ||
        previous.confirmedBy !== adminId
      )
        throw new HttpsError('already-exists', 'Identificador já utilizado em outro pagamento.')
      return
    }
    const plan = (plansDoc.data()?.plans || DEFAULT_BILLING.plans).find((p) => p.id === planId)
    if (!plan)
      throw new HttpsError('invalid-argument', 'Plano não encontrado na configuração atual.')
    const graceBusinessDays = config.data()?.graceBusinessDays ?? DEFAULT_BILLING.graceBusinessDays
    if (
      !Number.isFinite(plan.price) ||
      plan.price < 0 ||
      plan.price > 100000 ||
      !Number.isInteger(graceBusinessDays) ||
      graceBusinessDays < 0 ||
      graceBusinessDays > 30
    )
      throw new HttpsError('failed-precondition', 'Configuração de pagamento inválida.')
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
      subscription: {
        ...subscription,
        trialEndsAt: subscription.trialEndsAt || Timestamp.fromMillis(now),
        billingCycle: 'monthly',
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
  return { id: paymentRef.id, account: accountView(userId, (await userRef.get()).data()) }
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
    await assertWritableAccount(tx, userId)
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
  return { account: accountView(userId, (await userRef.get()).data()) }
})

const deletions = createDeletionService({
  db,
  auth: authAdmin,
  bucket,
  FieldValue,
  Timestamp,
  HttpsError,
})

export const deleteAccountPermanently = onCall(options, async (request) => {
  const adminId = requireUser(request)
  const error = validateDeleteAccount(request.data)
  if (error) throw new HttpsError('invalid-argument', error)
  return deletions.queue('account', request.data.userId, adminId)
})

export const deleteCommunityPermanently = onCall(options, async (request) => {
  const adminId = requireUser(request)
  if (!validId(request.data?.communityId))
    throw new HttpsError('invalid-argument', 'Comunidade inválida.')
  return deletions.queue('community', request.data.communityId, adminId)
})

export const cleanupDeletedStatus = onDocumentDeleted(
  { ...options, document: 'statuses/{id}', retry: true },
  (event) => {
    return deletions.queueDeleted('status', event.params.id, statusPhotoExtra(event.data?.data()))
  }
)
export const cleanupDeletedCommunity = onDocumentDeleted(
  { ...options, document: 'communities/{id}', retry: true },
  (event) => deletions.queueDeleted('community', event.params.id)
)

// memberCount denormalizado em communities/{id}, mantido por gatilho — o painel admin
// (useAdminCommunities) lê esse campo direto em vez de rodar uma aggregation query por
// comunidade exibida. Só a Admin SDK grava este campo (o cliente nunca escreve nele
// diretamente), então não há necessidade de regra especial nem risco de manipulação.
async function bumpMemberCount(communityId, delta) {
  if (!communityId) return
  try {
    await db.doc(`communities/${communityId}`).update({ memberCount: FieldValue.increment(delta) })
  } catch (error) {
    // Comunidade já pode ter sido excluída (corrida com cleanupDeletedCommunity) —
    // nesse caso o documento não existe mais e não há contagem para manter.
    console.error('bumpMemberCount', communityId, error.code)
  }
}
// Sem retry, de propósito: FieldValue.increment não é idempotente — uma nova tentativa
// depois de um "sucesso não confirmado" contaria a mesma entrada/saída duas vezes. Uma
// falha isolada aqui só deixa o contador levemente desatualizado (cosmético, no painel
// admin), o que é preferível a um valor sistematicamente errado.
export const onCommunityMemberJoin = onDocumentCreated(
  { ...options, document: 'communityMembers/{membershipId}' },
  (event) => bumpMemberCount(event.data?.data()?.communityId, 1)
)
export const onCommunityMemberLeave = onDocumentDeleted(
  { ...options, document: 'communityMembers/{membershipId}' },
  (event) => bumpMemberCount(event.data?.data()?.communityId, -1)
)

export const processDeletionJobs = onSchedule(
  { ...options, schedule: 'every 1 minutes', timeoutSeconds: 300 },
  async () => {
    const jobs = await db
      .collection('deletionJobs')
      .where('state', '==', 'pending')
      .orderBy('updatedAt')
      .limit(10)
      .get()
    for (const job of jobs.docs) {
      try {
        await deletions.step(job.ref)
      } catch (error) {
        console.error('Deletion job failed', job.id, error.code)
      }
    }
  }
)

// Publicações de texto/enquete/treino/conquista já ficam escondidas do feed pelo
// filtro expiresAt > now na própria query (useCommunityFeed) e nunca carregam
// nenhum arquivo — deixá-las no Firestore depois de expiradas não tem custo real.
// Fotos são diferentes: cada uma é um arquivo no Storage, então só escondê-las não
// basta, elas precisam ser apagadas de verdade. Apagar o documento aqui é só o
// gatilho — quem realmente cuida do arquivo é cleanupDeletedStatus + o job de
// deletionJobs (mesmo caminho usado por exclusão manual e por remove_content).
export const purgeExpiredPhotos = onSchedule(
  { ...options, schedule: 'every 15 minutes', timeoutSeconds: 300 },
  async () => {
    const expired = await db
      .collection('statuses')
      .where('type', '==', 'photo')
      .where('expiresAt', '<=', Timestamp.now())
      .limit(200)
      .get()
    if (expired.empty) return
    const batch = db.batch()
    expired.docs.forEach((item) => batch.delete(item.ref))
    await batch.commit()
  }
)

// Rede de segurança contra órfãos: se o upload para o Storage teve sucesso mas o
// setDoc do status em statusesService.js nunca chegou a acontecer (aba fechada,
// queda de conexão, erro), sobra um arquivo sem nenhum documento em statuses/{id}
// (o nome do arquivo é sempre esse id — ver createPhotoStatus). A folga de 1h evita
// disputar com um upload legítimo que ainda está em andamento.
const ORPHAN_GRACE_MS = 60 * 60 * 1000
// db.getAll() lê em lote em vez de 1 get() por arquivo, num loop sequencial — antes
// eram N idas ao Firestore (uma por arquivo do bucket); agora são ceil(N/300).
const ORPHAN_CHECK_CHUNK = 300
export const purgeOrphanedPhotos = onSchedule(
  { ...options, schedule: 'every 30 minutes', timeoutSeconds: 300 },
  async () => {
    const [files] = await bucket.getFiles({ prefix: 'statusPhotos/' })
    const now = Date.now()
    const candidates = files
      .map((file) => ({
        file,
        statusId: file.name.split('/').pop().replace(/\.webp$/, ''),
        createdAt: new Date(file.metadata.timeCreated).getTime(),
      }))
      .filter((candidate) => now - candidate.createdAt >= ORPHAN_GRACE_MS)
    for (let i = 0; i < candidates.length; i += ORPHAN_CHECK_CHUNK) {
      const chunk = candidates.slice(i, i + ORPHAN_CHECK_CHUNK)
      const docs = await db.getAll(...chunk.map((c) => db.doc(`statuses/${c.statusId}`)))
      await Promise.all(
        chunk
          .filter((_, index) => !docs[index].exists)
          .map((c) => c.file.delete({ ignoreNotFound: true }))
      )
    }
  }
)

export const listDeletionJobs = onCall(options, async (request) => {
  await requireSuperAdmin(requireUser(request))
  const jobs = await db
    .collection('deletionJobs')
    .where('state', '==', 'pending')
    .orderBy('updatedAt')
    .limit(50)
    .get()
  return {
    jobs: jobs.docs.map((job) => ({
      id: job.id,
      kind: job.data().kind,
      targetId: job.data().targetId,
      lastError: job.data().lastError || null,
    })),
  }
})
