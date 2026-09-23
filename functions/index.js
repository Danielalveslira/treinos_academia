import { createAccountsService } from './accounts-service.js'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore'
import { createDeletionService, statusPhotoExtra } from './deletion-service.js'
import { createCommunityModerationService } from './community-moderation-service.js'
import { createBumpMemberCount } from './community-members-service.js'
import { createSyncUserCommunityIds } from './user-communities-sync.js'
import { createEnforcePostRateLimit } from './rate-limit-service.js'
import { affectedWorkoutDays, createProgressDailyService } from './progress-daily-service.js'
import { validId } from './legal-core.js'
import { accountView, validateSetAccountStatus, validateDeleteAccount } from './admin-core.js'
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase-admin/app'
import {
  getFirestore,
  FieldValue,
  FieldPath,
  Timestamp,
  AggregateField,
} from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import {
  legalDigest,
  requestIp,
  validateAcceptance,
  calculateAge,
  validateSupportRequest,
  validateDecision,
} from './legal-core.js'
import {
  isProtectedRole,
  isSelfReport,
  REPORT_PROTECTED_AUTHOR_ERROR,
  REPORT_OWN_STATUS_ERROR,
} from './moderation-core.js'
import { createConfigService } from './economy/config-service.js'
import { createWalletService } from './economy/wallet-service.js'
import { createLedgerService } from './economy/ledger-service.js'
import { createActivityService } from './economy/activity-service.js'
import { createVoteService } from './economy/vote-service.js'
import { validateVoteOnPost } from './economy/vote-core.js'
import { createListPostEconomyVoters } from './economy/vote-query-service.js'
import { createListWorkoutParticipants } from './workout-participants-service.js'
import { createProfessionalListingService } from './professional-listing-service.js'
import { createProfileAvatarService } from './profile-avatar-service.js'
import sharp from 'sharp'
import { createCashPurchaseService } from './economy/cash-purchase-service.js'
import { createPixPaymentAdminService } from './economy/pix-payment-admin-service.js'
import { createPrivilegeService } from './economy/privilege-service.js'
import { createPromotionService } from './economy/promotion-service.js'
import { isTargetCurrentlyPromoted } from './economy/promotion-core.js'
import {
  createRewardSettlementService,
  SETTLEMENT_FUNCTION_TIMEOUT_SECONDS,
} from './economy/reward-settlement-service.js'
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
const showcaseManifest = JSON.parse(
  readFileSync(new URL('./legal/showcase-manifest.json', import.meta.url))
)
const showcaseDocument = JSON.parse(
  readFileSync(new URL('./legal/showcase-document.json', import.meta.url))
)
const showcaseDigest = legalDigest(showcaseManifest, [showcaseDocument])
const options = { region: 'southamerica-east1', maxInstances: 5 }
const rebuildProgressDay = createProgressDailyService({ db, Timestamp, FieldValue })

const professionalListings = createProfessionalListingService({
  db,
  bucket,
  FieldValue,
  HttpsError,
  showcaseLegal: {
    manifest: showcaseManifest,
    digest: showcaseDigest,
  },
})
const profileAvatars = createProfileAvatarService({
  db,
  bucket,
  FieldValue,
  HttpsError,
  inspectImage: async (buffer) => sharp(buffer, { limitInputPixels: 2560000 }).metadata(),
})

export const createProfessionalListingDraft = onCall(options, (request) =>
  professionalListings.createDraft(requireUser(request), request.data || {})
)
export const saveProfessionalListingDraft = onCall(options, (request) =>
  professionalListings.saveDraft(requireUser(request), request.data || {})
)
export const submitProfessionalListing = onCall(options, (request) =>
  professionalListings.submit(requireUser(request), request.data || {})
)
export const reviewProfessionalListing = onCall(options, (request) =>
  professionalListings.review(requireUser(request), request.data || {})
)
export const unpublishProfessionalListing = onCall(options, (request) =>
  professionalListings.unpublish(requireUser(request), request.data || {})
)
export const suspendProfessionalListing = onCall(options, (request) =>
  professionalListings.suspend(requireUser(request), request.data || {})
)
export const reportProfessionalListing = onCall(options, (request) =>
  professionalListings.report(requireUser(request), request.data || {})
)
export const resolveProfessionalListingReport = onCall(options, (request) =>
  professionalListings.resolveReport(requireUser(request), request.data || {})
)
export const deleteProfessionalListing = onCall(options, (request) =>
  professionalListings.deleteListing(requireUser(request), request.data || {})
)
export const allocateProfileAvatar = onCall(options, (request) =>
  profileAvatars.allocate(requireUser(request))
)
export const confirmProfileAvatar = onCall(options, (request) =>
  profileAvatars.confirm(requireUser(request), request.data || {})
)
export const removeProfileAvatar = onCall(options, (request) =>
  profileAvatars.remove(requireUser(request))
)
export const purgeExpiredProfileAvatars = onSchedule(
  { ...options, schedule: 'every 24 hours', timeoutSeconds: 300 },
  () => profileAvatars.purgeExpired()
)

// Recalcula o dia inteiro em vez de aplicar incrementos. Assim criação, edição,
// exclusão, mudança de data e retry do trigger produzem sempre o mesmo resumo.
export const onWorkoutWritten = onDocumentWritten(
  { ...options, document: 'users/{uid}/workouts/{workoutId}', retry: true },
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()
    const days = affectedWorkoutDays(before, after)
    await Promise.all(days.map((day) => rebuildProgressDay(event.params.uid, day)))
  }
)

// AUD-007: política de retenção da cópia de evidência (moderationEvidence/*.webp).
// Ligada ao ciclo de vida do próprio chamado, não a um prazo fixo desde a criação:
//   - enquanto o pedido segue aberto, a evidência precisa sobreviver até alguém
//     decidir -- por isso o prazo abaixo é só uma rede de segurança (pedido
//     esquecido/nunca decidido), generoso o bastante para não apagar evidência de
//     um caso em análise.
//   - cancelado pelo próprio autor ou decidido como no_action: nenhuma medida foi
//     baseada nela, não há motivo de auditoria para guardar por mais tempo.
//   - decidido com alguma penalidade real (suspensão, banimento, remoção de
//     conteúdo): a evidência passa a sustentar um moderationDecision permanente
//     (essa coleção já não é apagada por nenhum job) -- aqui a retenção indefinida é
//     uma decisão deliberada e documentada, não um esquecimento. evidenceExpiresAt
//     fica null nesse caso, e purgeExpiredModerationEvidence nunca a seleciona.
const EVIDENCE_PENDING_RETENTION_MS = 30 * 86400000
const EVIDENCE_NO_ACTION_RETENTION_MS = 7 * 86400000

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

const getEconomyConfig = createConfigService({ db })
const walletService = createWalletService({ db, FieldValue })
const ledgerService = createLedgerService({ db, FieldValue })
const registerActivity = createActivityService({
  db,
  FieldValue,
  wallet: walletService,
  ledger: ledgerService,
  getEconomyConfig,
  assertWritableAccount,
})

// Economia interna (EvoCoins/EvoCash) -- Fase 1: só recompensa diária por atividade
// qualificada. O cliente nunca envia minutos, só sinaliza "aconteceu uma ação real
// agora" (ver useQualifiedActivity.js); todo o cálculo de tempo decorrido é feito aqui
// com o relógio do servidor (ver activity-core.js: activeMinutes vem exclusivamente do
// intervalo entre chamadas consecutivas, nunca de um valor enviado pelo cliente).
//
// Candidata natural a `enforceAppCheck: true` (seção 27 do prompt de economia) assim
// que o site key de reCAPTCHA estiver publicado em produção -- hoje nenhuma callable do
// projeto liga essa opção (App Check ainda é best-effort, ver src/firebase/config.js),
// então não é ligada isoladamente só aqui. A validação de negócio em si (limites de
// checkpoint, idempotência) não depende de App Check para ser segura.
export const registerQualifiedActivity = onCall(options, async (request) => {
  const uid = requireUser(request)
  return registerActivity(uid)
})

const castVote = createVoteService({
  db,
  FieldValue,
  wallet: walletService,
  ledger: ledgerService,
  getEconomyConfig,
  assertWritableAccount,
  HttpsError,
})

// Voto econômico (Fase 2 -- seções 12-14 do prompt de economia): positivo/negativo,
// custa EvoCoins na primeira vez, trocar de direção depois é grátis, remover não
// reembolsa. Deliberadamente em statuses/{id}/economyVotes/{uid}, nunca em
// statuses/{id}/votes/{uid} -- essa outra coleção é o voto de ENQUETE, gratuito e sem
// nenhuma relação com a carteira; não reaproveitar nem confundir uma com a outra (ver
// vote-core.js). rewardState fica pronto no documento desde já (seção 14), mas o
// processamento em si (crédito ao autor) só chega na Fase 3 -- aqui a recompensa nunca
// é paga, só marcada como pending/ineligible.
//
// Candidata a `enforceAppCheck: true` (seção 27), mesma justificativa de
// registerQualifiedActivity acima -- não ligada isoladamente aqui pelo mesmo motivo. O
// limite diário de votos pagos (maxVotesPerUserDay) já cobre o rate limiting específico
// pedido pela seção 27 para esta ação.
// LEGADO -- mantida só até confirmar que nenhum cliente ainda a chama (o frontend
// migrou para voteOnPostV2/us-central1 depois do A/B: 66-77% mais rápido contra o
// mesmo banco nam5, region/rede era o gargalo real, não a lógica). Candidata a remoção
// assim que o smoke em produção confirmar 100% do tráfego em voteOnPostV2.
export const voteOnPost = onCall(options, async (request) => {
  const uid = requireUser(request)
  const error = validateVoteOnPost(request.data)
  if (error) throw new HttpsError('invalid-argument', error)
  return castVote(uid, request.data.statusId, request.data.value)
})

// Endpoint DEFINITIVO do voto econômico (pós A/B, ver auditoria de latência) -- mesmo
// banco (nam5), mesma lógica (castVote é a mesma instância de createVoteService usada
// por voteOnPost acima, nenhuma duplicação), só a região muda. Sem minInstances --
// cold start já se mostrou um fator secundário frente ao ganho de região/rede.
const optionsUsCentral = { ...options, region: 'us-central1' }
export const voteOnPostV2 = onCall(optionsUsCentral, async (request) => {
  const uid = requireUser(request)
  const error = validateVoteOnPost(request.data)
  if (error) throw new HttpsError('invalid-argument', error)
  return castVote(uid, request.data.statusId, request.data.value)
})

// "Ver quem votou" -- positiveVoteCount/negativeVoteCount em statuses/{id}, mantidos
// na MESMA transação de voteOnPost (ver vote-service.js), nunca por um gatilho
// Firestore separado -- gatilhos podem ser entregues mais de uma vez, e um contador
// incremental sem deduplicação persistente (FieldValue.increment não é idempotente)
// causaria drift a cada reentrega. Como toda escrita em economyVotes já passa por
// voteOnPost, o incremento cabe na mesma transação sem custo extra de leitura/escrita
// nem risco de dupla contagem. O settlement da Fase 3 só atualiza campos de reward do
// voto (rewardState/rewardPendingAt/...), nunca `value` -- por isso nunca precisa
// tocar nestes contadores.
//
// "Ver quem votou" -- nunca expõe statuses/{id}/economyVotes diretamente (campos
// internos da economia: charged, rewardState, timestamps de recompensa, ver
// firestore.rules). Só dados públicos e sanitizados por votante (ver
// vote-query-service.js). Checagem de acesso equivalente à leitura de statuses/{id}
// (isSignedIn + isMember: conta com acesso ao app, sem restrição na comunidade, sem
// job de exclusão da comunidade, membro dela), com bypass total para superadmin --
// nunca menos restrita que a Rule real. Em us-central1 (não southamerica-east1) pelo
// mesmo motivo do voto: consulta Firestore-heavy contra o mesmo banco nam5, o A/B já
// provou que a região da Function importa mais que a distância geográfica do usuário.
const listVoters = createListPostEconomyVoters({ db, Timestamp, HttpsError })
export const listPostEconomyVoters = onCall(optionsUsCentral, async (request) => {
  const uid = requireUser(request)
  return listVoters(uid, {
    statusId: request.data?.statusId,
    direction: request.data?.direction,
    cursor: request.data?.cursor ?? null,
    limit: request.data?.limit,
  })
})

// "Ver participantes" (Treino Marcado V1) -- mesma checagem de acesso de
// listPostEconomyVoters (reaproveita resolvePostAccessDenialReason), mas nunca chamada
// automaticamente por card: só quando o membro abre "Ver participantes" no
// WorkoutStatus. Região padrão (southamerica-east1), não us-central1 -- ação sob
// demanda, de baixa frequência, não justifica a mesma otimização de latência do voto.
const listParticipants = createListWorkoutParticipants({ db, Timestamp, HttpsError })
export const listWorkoutParticipants = onCall(options, async (request) => {
  const uid = requireUser(request)
  return listParticipants(uid, {
    statusId: request.data?.statusId,
    cursor: request.data?.cursor ?? null,
    limit: request.data?.limit,
  })
})

const cashPurchases = createCashPurchaseService({
  db,
  FieldValue,
  wallet: walletService,
  ledger: ledgerService,
  assertWritableAccount,
  HttpsError,
})

// EvoCash (Fase 4 -- seções 20-23 do prompt de economia): compra manual/PIX com
// confirmação administrativa. O cliente nunca envia preço/quantidade, só packageId --
// requestCashPurchase sempre lê economyConfig/current fresco (nunca o cache com TTL de
// getEconomyConfig(), usado só para EvoCoins) e bloqueia a operação se a config
// estiver ausente ou o pacote for inválido/inativo, nunca cai num valor padrão (dinheiro
// real). requestId é gerado uma vez pelo cliente e reenviado em qualquer retry --
// idempotência real via ID de documento determinístico (uid+requestId), não uma
// checagem best-effort.
export const requestCashPurchase = onCall(options, async (request) => {
  const uid = requireUser(request)
  return cashPurchases.requestCashPurchase(uid, {
    packageId: request.data?.packageId,
    requestId: request.data?.requestId,
  })
})

export const confirmCashPurchase = onCall(options, async (request) => {
  const adminId = requireUser(request)
  const purchaseId = request.data?.purchaseId
  if (!validId(purchaseId)) throw new HttpsError('invalid-argument', 'Compra inválida.')
  return cashPurchases.confirmCashPurchase(adminId, purchaseId, request.data?.adminNote)
})

export const cancelCashPurchase = onCall(options, async (request) => {
  const adminId = requireUser(request)
  const purchaseId = request.data?.purchaseId
  if (!validId(purchaseId)) throw new HttpsError('invalid-argument', 'Compra inválida.')
  return cashPurchases.cancelCashPurchase(adminId, purchaseId, request.data?.reason)
})

// Administração de chaves PIX (/admin/pagamentos) -- privatePaymentConfig/pix é
// server-only (ver firestore.rules: allow read, write: if false), então este é o ÚNICO
// caminho pra ler/gravar. Cada função do serviço verifica role==='superadmin' na própria
// transação (mesmo padrão de confirmCashPurchase/cancelCashPurchase acima); requireUser
// aqui só garante que existe um chamador autenticado antes de gastar uma leitura.
const pixPaymentAdmin = createPixPaymentAdminService({ db, FieldValue, HttpsError })

export const listPixPaymentMethods = onCall(options, async (request) => {
  const adminId = requireUser(request)
  return pixPaymentAdmin.listPixPaymentMethods(adminId)
})

export const savePixPaymentMethod = onCall(options, async (request) => {
  const adminId = requireUser(request)
  return pixPaymentAdmin.savePixPaymentMethod(adminId, {
    methodId: request.data?.methodId || null,
    label: request.data?.label,
    key: request.data?.key,
    keyType: request.data?.keyType,
    recipientName: request.data?.recipientName,
  })
})

export const setActivePixPaymentMethod = onCall(options, async (request) => {
  const adminId = requireUser(request)
  return pixPaymentAdmin.setActivePixPaymentMethod(adminId, { methodId: request.data?.methodId })
})

export const deletePixPaymentMethod = onCall(options, async (request) => {
  const adminId = requireUser(request)
  return pixPaymentAdmin.deletePixPaymentMethod(adminId, { methodId: request.data?.methodId })
})

export const setPixPaymentsEnabled = onCall(options, async (request) => {
  const adminId = requireUser(request)
  return pixPaymentAdmin.setPixPaymentsEnabled(adminId, { enabled: request.data?.enabled })
})

const privileges = createPrivilegeService({
  db,
  FieldValue,
  wallet: walletService,
  ledger: ledgerService,
  assertWritableAccount,
  HttpsError,
})

// Fase 5 (privilégios com EvoCash) -- primeiro privilégio: criação de comunidade paga.
// Reaproveita a MESMA coleção communities/mesmo schema que o painel admin já escreve
// direto via Rules (ver firestore.rules); este caminho é só para usuários comuns, com
// elegibilidade + débito + criação atômicos (ver privilege-service.js). email_verified
// vem do próprio token do chamador (Firebase Auth), nunca de um campo do Firestore --
// mesma fonte que firestore.rules usa em emailVerifiedOk().
export const createCommunityWithCash = onCall(options, async (request) => {
  const uid = requireUser(request)
  return privileges.createCommunityWithCash(uid, {
    name: request.data?.name,
    description: request.data?.description,
    iconName: request.data?.iconName,
    requestId: request.data?.requestId,
    emailVerified: request.auth.token.email_verified === true,
  })
})

const promotions = createPromotionService({
  db,
  FieldValue,
  Timestamp,
  wallet: walletService,
  ledger: ledgerService,
  assertWritableAccount,
  HttpsError,
})

// Fase 6 (promoções pagas com EvoCash) -- pacote fixo, duração fixa, sem CPC/CPM/
// leilão. Elegibilidade + débito + criação atômicos numa única transação (mesmo
// esqueleto de createCommunityWithCash, ver promotion-service.js). Nunca toca em
// sponsoredAds (coleção/Rules/tela institucionais, superadmin-only) -- são sistemas
// completamente separados, mesmo que ambos deem mais exposição a algo dentro do app.
export const createPromotion = onCall(options, async (request) => {
  const uid = requireUser(request)
  return promotions.createPromotion(uid, {
    targetType: request.data?.targetType,
    targetId: request.data?.targetId,
    packageId: request.data?.packageId,
    requestId: request.data?.requestId,
  })
})

export const cancelPromotion = onCall(options, async (request) => {
  const uid = requireUser(request)
  return promotions.cancelPromotion(uid, {
    promotionId: request.data?.promotionId,
    reason: request.data?.reason,
  })
})

// Métricas informativas (App Check ainda adiado -- nunca participam de preço, cobrança
// ou ranking financeiro). V1 só grava clique; impressão fica para uma evolução
// posterior (dispararia a cada render/scroll, volume de writes bem maior).
export const recordPromotionEvent = onCall(options, async (request) => {
  const uid = requireUser(request)
  return promotions.recordPromotionEvent(uid, {
    targetType: request.data?.targetType,
    targetId: request.data?.targetId,
    promotionId: request.data?.promotionId,
    type: request.data?.type,
  })
})

const settleVoteRewards = createRewardSettlementService({
  db,
  FieldValue,
  Timestamp,
  wallet: walletService,
  ledger: ledgerService,
  getEconomyConfig,
})

// Settlement assíncrono de recompensa (Fase 3 -- reward-settlement-service.js): credita
// o autor pelos votos positivos elegíveis, nunca no caminho crítico do voto em si (que
// só marca rewardState:'pending', ver vote-service.js). Lease próprio (não o padrão
// leaseToken/leaseUntil de deletionJobs, que é por JOB individual -- aqui é 1 lease
// para a execução inteira, ver reward-settlement-service.js) garante que duas execuções
// do scheduler nunca processam a fila ordenada em paralelo. timeoutSeconds IMPORTADO de
// reward-settlement-service.js (não repetido aqui) -- a duração do lease é derivada
// exatamente deste valor, então os dois nunca podem divergir silenciosamente (auditoria
// operacional: um timeoutSeconds maior que a duração do lease permitiria uma segunda
// execução assumir o lease enquanto a primeira ainda está, tecnicamente, autorizada a
// processar).
export const settleVoteRewardsScheduled = onSchedule(
  { ...options, schedule: 'every 5 minutes', timeoutSeconds: SETTLEMENT_FUNCTION_TIMEOUT_SECONDS },
  async () => {
    try {
      const result = await settleVoteRewards()
      // Sempre loga, inclusive skipped:true (conflito de lease) -- antes só o caminho
      // feliz era logado, o que escondia todo conflito de lease dos logs. Estrutura
      // simples (console.log de um objeto) é suficiente para a V1 (seção 3 da
      // auditoria): processed/capped/promoted por run, duração, oldestPendingAgeMs
      // (atraso da fila) e a própria contagem de skipped:true (=conflitos de lease) já
      // saem filtráveis no Cloud Logging sem nenhuma infra de métricas adicional.
      console.log('reward settlement', result)
    } catch (error) {
      console.error('Reward settlement failed', error.code || error.message)
    }
  }
)

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
    // Nunca confia num "ageConfirmed" enviado pelo cliente (removido do formulário —
    // ver LegalConsent.jsx): a idade mínima é sempre calculada aqui, a partir da data
    // de nascimento já gravada no próprio documento (setBirthInfo em usersService.js,
    // chamado antes deste passo no fluxo de cadastro em Register.jsx).
    const birthDate = user.data().dataNascimento
    if (!birthDate || calculateAge(birthDate) < manifest.minimumAge) {
      throw new HttpsError(
        'failed-precondition',
        `É necessário ter pelo menos ${manifest.minimumAge} anos para aceitar os documentos.`
      )
    }
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
  // AUD-007: precisa sobreviver à transação (a cópia da foto de evidência, mais
  // abaixo, roda depois dela) -- reatribuída a cada tentativa da transação, mas só a
  // da tentativa que de fato commitar importa.
  let snapshot = null
  await db.runTransaction(async (tx) => {
    await assertWritableAccount(tx, uid)
    const limit = await tx.get(throttle)
    const now = Date.now()
    if (limit.exists && now - limit.data().lastRequestAt.toMillis() < 60000) {
      throw new HttpsError('resource-exhausted', 'Aguarde um minuto antes de enviar outro pedido.')
    }
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
  // AUD-007: a denúncia de uma foto guardava só photoPath (um ponteiro) no
  // contentSnapshot -- quando a publicação expirava (24h) ou era excluída, o arquivo
  // no Storage ia junto, e a evidência sumia antes de um moderador conseguir vê-la.
  // Copiamos o arquivo para um local fora do ciclo de vida da publicação, fora da
  // transação (Storage não participa de transações do Firestore). Best-effort: o
  // relato já foi criado e é válido mesmo se esta cópia falhar (ex.: o arquivo já
  // tinha sido apagado no intervalo entre o clique em "Denunciar" e esta chamada).
  if (snapshot?.type === 'photo' && snapshot.photoPath) {
    try {
      const evidencePath = `moderationEvidence/${ref.id}.webp`
      await bucket.file(snapshot.photoPath).copy(bucket.file(evidencePath))
      await ref.update({
        evidencePath,
        evidenceExpiresAt: Timestamp.fromMillis(Date.now() + EVIDENCE_PENDING_RETENTION_MS),
      })
    } catch (copyError) {
      console.error(
        'Failed to preserve report photo evidence',
        ref.id,
        copyError.code || copyError.message
      )
    }
  }
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
      // AUD-007: cancelado pelo próprio autor -- nenhuma medida foi tomada com base
      // nesta evidência, não há motivo de auditoria para guardá-la pelo prazo cheio.
      ...(support.data().evidencePath
        ? { evidenceExpiresAt: Timestamp.fromMillis(Date.now() + EVIDENCE_NO_ACTION_RETENTION_MS) }
        : {}),
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
      throw new HttpsError('invalid-argument', 'Pedidos de privacidade não aplicam penalidades.')
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
      // AUD-007: uma penalidade real (suspensão/banimento/remoção) transforma a
      // evidência em sustentação de um moderationDecision permanente -- retenção
      // indefinida aqui é deliberada, não um esquecimento (ver comentário na
      // constante EVIDENCE_PENDING_RETENTION_MS). no_action/restore não aplicaram
      // nenhuma medida com base nela, então volta a ter prazo curto.
      ...(data.evidencePath
        ? {
            evidenceExpiresAt: [
              'temporary_suspension',
              'system_ban',
              'community_ban',
              'remove_content',
            ].includes(action)
              ? null
              : Timestamp.fromMillis(Date.now() + EVIDENCE_NO_ACTION_RETENTION_MS),
          }
        : {}),
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

// Ativar/desativar é um estado administrativo independente, usado para moderação
// (ver firestore.rules: hasAppAccess). Desativar sempre exige um motivo.
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

const communityModeration = createCommunityModerationService({
  db,
  FieldValue,
  HttpsError,
  isProtectedRole,
})

// Fase 5 (privilégios): caminho DEDICADO para banir/desbanir de UMA comunidade --
// deliberadamente NÃO uma ampliação de decideSupportRequest (ver
// community-moderation-service.js para o porquê). O único trabalho daqui é extrair
// request.data e checar o formato dos IDs -- toda a autorização/regra de negócio mora
// no service, testável sem depender deste arquivo.
export const setCommunityMemberBan = onCall(options, async (request) => {
  const adminId = requireUser(request)
  const communityId = request.data?.communityId
  const targetUserId = request.data?.targetUserId
  if (!validId(communityId) || !validId(targetUserId)) {
    throw new HttpsError('invalid-argument', 'Dados inválidos.')
  }
  return communityModeration.setCommunityMemberBan(adminId, {
    communityId,
    targetUserId,
    banned: request.data?.banned === true,
    reason: request.data?.reason,
  })
})

// Fase 6: uma promoção ativa NUNCA é apagada quando o alvo some (histórico econômico
// real -- EvoCash já foi gasto -- mesmo tratamento que cashPurchases/economyTransactions
// já recebem em deletion-service.js). markTargetRemoved só fecha o status como
// 'target_removed'; idempotente, seguro sob retry:true.
export const cleanupDeletedStatus = onDocumentDeleted(
  { ...options, document: 'statuses/{id}', retry: true },
  (event) => {
    return Promise.all([
      deletions.queueDeleted('status', event.params.id, statusPhotoExtra(event.data?.data())),
      promotions.markTargetRemoved('post', event.params.id),
    ])
  }
)
export const cleanupDeletedCommunity = onDocumentDeleted(
  { ...options, document: 'communities/{id}', retry: true },
  (event) =>
    Promise.all([
      deletions.queueDeleted('community', event.params.id),
      promotions.markTargetRemoved('community', event.params.id),
    ])
)

const bumpMemberCount = createBumpMemberCount({ db, FieldValue })
const syncUserCommunityIds = createSyncUserCommunityIds({ db, FieldValue })
// Sem retry, de propósito: FieldValue.increment não é idempotente — uma nova tentativa
// depois de um "sucesso não confirmado" contaria a mesma entrada/saída duas vezes. Uma
// falha isolada aqui só deixa o contador levemente desatualizado (cosmético, no painel
// admin), o que é preferível a um valor sistematicamente errado. syncUserCommunityIds
// usa arrayUnion/arrayRemove (idempotente por natureza), então não tem o mesmo problema.
export const onCommunityMemberJoin = onDocumentCreated(
  { ...options, document: 'communityMembers/{membershipId}' },
  (event) => {
    const data = event.data?.data()
    return Promise.all([
      bumpMemberCount(data?.communityId, 1),
      syncUserCommunityIds(data?.userId, data?.communityId, 'join'),
    ])
  }
)
export const onCommunityMemberLeave = onDocumentDeleted(
  { ...options, document: 'communityMembers/{membershipId}' },
  (event) => {
    const data = event.data?.data()
    return Promise.all([
      bumpMemberCount(data?.communityId, -1),
      syncUserCommunityIds(data?.userId, data?.communityId, 'leave'),
    ])
  }
)

// Achado #3 da auditoria de segurança: rate limit de publicações. Roda depois da escrita
// já ter acontecido (onCreate, não bloqueia o primeiro post de um flood) de propósito —
// ver rate-limit-service.js para por que não entrou nas regras de canCreateStatus().
const enforcePostRateLimit = createEnforcePostRateLimit({ db, FieldValue, Timestamp })
export const onStatusCreate = onDocumentCreated(
  { ...options, document: 'statuses/{statusId}' },
  (event) => enforcePostRateLimit(event.data?.data()?.authorId)
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
    const nowMs = Date.now()
    // Fase 6: post_boost_3d/post_boost_7d só fazem sentido se o documento continuar
    // existindo pelos 3-7 dias pagos -- sem este filtro, uma foto com promoção ativa
    // seria apagada ~24h depois de publicada mesmo tendo pago por mais dias de
    // destaque (auditoria confirmou este job ignorava `promoted` por completo).
    const toDelete = expired.docs.filter((item) => {
      const data = item.data()
      return !isTargetCurrentlyPromoted(
        { promoted: data.promoted, promotedUntilMs: data.promotedUntil?.toMillis() ?? null },
        nowMs
      )
    })
    if (toDelete.length === 0) return
    const batch = db.batch()
    toDelete.forEach((item) => batch.delete(item.ref))
    await batch.commit()
  }
)

// Rede de segurança para arquivos legados ou inconsistências excepcionais. O fluxo
// atual cria statuses/{id} antes do upload e remove o documento se o envio falhar;
// ainda assim, arquivos antigos ou uma falha durante a limpeza podem deixar bytes sem
// documento correspondente. A folga de 1h evita disputar com uma operação legítima.
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
        statusId: file.name
          .split('/')
          .pop()
          .replace(/\.webp$/, ''),
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

// AUD-007: aplica a política de retenção definida em submitSupportRequest/
// cancelSupportRequest/decideSupportRequest (ver EVIDENCE_PENDING_RETENTION_MS
// acima) -- nunca decide reter ou apagar por conta própria, só executa o prazo já
// calculado em evidenceExpiresAt. Documentos com penalidade real (evidenceExpiresAt:
// null) nunca entram nesta consulta: uma comparação "<=" do Firestore não seleciona
// campo nulo nem ausente, então ficam de fora automaticamente, sem checagem extra.
export const purgeExpiredModerationEvidence = onSchedule(
  { ...options, schedule: 'every 24 hours', timeoutSeconds: 300 },
  async () => {
    const expired = await db
      .collection('supportRequests')
      .where('evidenceExpiresAt', '<=', Timestamp.now())
      .limit(200)
      .get()
    if (expired.empty) return
    await Promise.all(
      expired.docs.map(async (item) => {
        const { evidencePath } = item.data()
        if (evidencePath) await bucket.file(evidencePath).delete({ ignoreNotFound: true })
        // O chamado em si (mensagem, decisão, resposta) permanece -- só os bytes da
        // foto e o prazo já cumprido saem do documento.
        await item.ref.update({
          evidencePath: FieldValue.delete(),
          evidenceExpiresAt: FieldValue.delete(),
        })
      })
    )
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

// AUD-006: o resumo público (entries/sets) era calculado E gravado pelo próprio
// cliente (publicProfilesService.refreshPublicStatistics fazia um setDoc direto);
// firestore.rules só validava "números não negativos", nunca que os valores batiam
// com o diário de treino real — um cliente modificado podia forjar qualquer total.
// Agora o cálculo roda aqui, com Admin SDK, sobre a mesma agregação que o cliente já
// usava (count/sum via getAggregateFromServer) — só que sem o cliente poder escolher
// o resultado. firestore.rules passa a bloquear create/update client-side nesse
// documento (só leitura e delete continuam liberados ao dono).
export const refreshPublicStatistics = onCall(options, async (request) => {
  const uid = requireUser(request)
  const profile = await db.doc(`publicProfiles/${uid}`).get()
  if (!profile.exists || profile.data().shareStatistics !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Ative o compartilhamento de estatísticas antes de atualizar.'
    )
  }
  const aggregate = await db
    .collection(`users/${uid}/workouts`)
    .aggregate({ entries: AggregateField.count(), sets: AggregateField.sum('sets') })
    .get()
  const entries = aggregate.data().entries
  const sets = aggregate.data().sets || 0
  await db.doc(`publicProfiles/${uid}/statistics/summary`).set({
    entries,
    sets,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { entries, sets }
})

// AUD-010: a troca de @ do cliente (usersService.updateUserProfile) precisa de DOIS
// commits distintos — reservar usernames/{novo} primeiro, só então atualizar
// users/publicProfiles — porque firestore.rules exige que a reserva já exista antes
// de aceitar o novo username (ownsUsernameField) e regras nunca enxergam escritas
// irmãs ainda pendentes na mesma transação do cliente. Uma falha de rede entre os
// dois commits deixava o novo @ reservado sem nunca virar o username de ninguém —
// indisponível para todo mundo, inclusive para o próprio dono pretendido, até ele
// tentar de novo com o mesmo valor. Com Admin SDK (sem essa restrição de regras) os
// três documentos mudam numa única transação, atômica de verdade.
export const renameUsername = onCall(options, async (request) => {
  const uid = requireUser(request)
  const username = String(request.data?.username || '')
    .trim()
    .toLowerCase()
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    throw new HttpsError('invalid-argument', 'Nome de usuário inválido.')
  }
  await db.runTransaction(async (tx) => {
    await assertWritableAccount(tx, uid)
    const userRef = db.doc(`users/${uid}`)
    const publicRef = db.doc(`publicProfiles/${uid}`)
    const newReservationRef = db.doc(`usernames/${username}`)
    const [user, publicProfile, reservation] = await tx.getAll(
      userRef,
      publicRef,
      newReservationRef
    )
    if (!user.exists) throw new HttpsError('failed-precondition', 'Perfil não encontrado.')
    const previousUsername = user.data().username
    if (previousUsername === username) return
    if (reservation.exists && reservation.data().uid !== uid) {
      throw new HttpsError('already-exists', 'Esse nome de usuário já está em uso.')
    }
    if (!reservation.exists) {
      tx.set(newReservationRef, { uid, createdAt: FieldValue.serverTimestamp() })
    }
    tx.update(userRef, { username })
    if (publicProfile.exists) {
      tx.update(publicRef, { username })
    } else {
      tx.set(publicRef, { username, bio: null, shareStatistics: false })
    }
    if (previousUsername) tx.delete(db.doc(`usernames/${previousUsername}`))
  })
  return { username }
})
