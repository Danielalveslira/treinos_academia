// Só publicações do tipo foto carregam esse campo. Extraída como função própria e
// usada tanto aqui (removeStatuses, que apaga o status em lote durante a exclusão de
// uma conta/comunidade) quanto no gatilho onDocumentDeleted de statuses/{id} em
// index.js, que trata a exclusão direta de uma publicação pelo próprio autor — as duas
// formas de chegar à exclusão de um status precisam copiar o mesmo dado pro job de
// limpeza, senão a foto fica sem referência (ver queueDeleted: um job "sem foto" criado
// primeiro vence e o gatilho, chegando depois com o dado certo, encontra o job já
// existente e desiste).
import { financialBlockReason } from './economy/cash-purchase-core.js'

export function statusPhotoExtra(data) {
  return data?.type === 'photo' && data.photoPath ? { photoPath: data.photoPath } : {}
}

// Durable deletion jobs double as write fences. Completed account jobs remain as
// tombstones so an old authentication token cannot recreate the deleted profile.
// Sem um orçamento de tempo, step() processava UMA página (100 docs) de UM estágio por
// chamada e devolvia o controle -- com o agendador rodando a cada minuto e até 10 jobs
// por execução, uma conta com milhares de registros (status, votos, participações)
// podia levar horas para terminar, sempre reprocessando a fila inteira a cada volta.
// Usado como teto PADRÃO quando step() é chamado sem um deadline explícito (ex.: um
// teste, ou uma chamada avulsa) -- processDeletionJobs em index.js passa o seu próprio,
// derivado do timeoutSeconds da função agendada.
const DEFAULT_STEP_BUDGET_MS = 4 * 60 * 1000
// Cobre o deadline inteiro (+ folga) -- sem isso, uma lease de duração fixa (2min)
// menor que o orçamento de processamento expirava NO MEIO de uma chamada ainda em
// andamento, permitindo que outra execução do agendador (elas podem se sobrepor; a
// lease é o que já as torna seguras de rodar em paralelo) reivindicasse o mesmo job.
const LEASE_BUFFER_MS = 30 * 1000

export function createDeletionService({ db, auth, bucket, FieldValue, Timestamp, HttpsError }) {
  const jobRef = (kind, id) => db.doc(`deletionJobs/${kind}_${id}`)
  const batchSize = 100

  // Chamada tanto de queue() (síncrona, assim que a exclusão é solicitada) quanto do
  // estágio 0 de step() (rede de segurança idempotente, caso a chamada em queue()
  // falhe) -- desativar duas vezes não é erro, o Admin SDK trata como no-op.
  async function disableAuthAccount(uid) {
    try {
      await auth.updateUser(uid, { disabled: true })
      await auth.revokeRefreshTokens(uid)
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error
    }
  }

  async function queue(kind, id, adminId) {
    const job = jobRef(kind, id)
    const created = await db.runTransaction(async (tx) => {
      const target = db.doc(`${kind === 'account' ? 'users' : 'communities'}/${id}`)
      const [admin, previous, entity, migration] = await tx.getAll(
        db.doc(`users/${adminId}`),
        job,
        target,
        db.doc('maintenance/adminV1')
      )
      // Fase 5: excluir uma COMUNIDADE (nunca uma conta) também é um poder do dono --
      // entity já É o documento da comunidade neste caso (lido acima como `target`),
      // então checar ownerId não custa nenhuma leitura extra.
      const isCommunityOwner =
        kind === 'community' && entity.exists && entity.data().ownerId === adminId
      if (admin.data()?.role !== 'superadmin' && !isCommunityOwner)
        throw new HttpsError('permission-denied', 'Acesso administrativo necessário.')
      if (kind === 'account' && id === adminId)
        throw new HttpsError('failed-precondition', 'Você não pode excluir a própria conta.')
      if (entity.data()?.role === 'superadmin')
        throw new HttpsError('failed-precondition', 'Não é possível excluir um administrador.')
      if (previous.exists) return false
      if (!entity.exists && kind !== 'account')
        throw new HttpsError('not-found', 'Registro não encontrado.')
      if (kind === 'account' && migration.data()?.interactionsVersion !== 1) {
        throw new HttpsError(
          'failed-precondition',
          'A preparação dos dados antigos ainda não foi concluída.'
        )
      }
      tx.create(job, {
        kind,
        targetId: id,
        requestedBy: adminId,
        state: 'pending',
        stage: 0,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      })
      if (entity.exists)
        tx.update(
          target,
          kind === 'account'
            ? { accountStatus: 'deleting' }
            : { isActive: false, deletionStatus: 'pending' }
        )
      return true
    })
    // Síncrono, antes de devolver a resposta ao chamador -- sem esperar o próximo
    // tick do agendador (até ~1 minuto, mais se a fila estiver ocupada) para que a
    // conta pare de conseguir logar. A trava do Firestore (deletionJobs/account_{uid},
    // já em vigor desde a transação acima) já barra qualquer sessão existente
    // imediatamente; isto fecha a OUTRA metade -- impedir um login NOVO. Só na
    // primeira vez (created:true) -- uma chamada repetida (job já existente, replay
    // idempotente) não precisa desativar de novo uma conta que step() já deve ter
    // desativado ou até excluído. Best-effort de propósito: se falhar aqui (rede
    // etc.), o estágio 0 de step() tenta de novo no próximo tick, então uma falha
    // nunca deveria travar a resposta ao admin nem deixar a exclusão sem essa
    // proteção para sempre.
    if (created && kind === 'account') {
      await disableAuthAccount(id).catch((error) => {
        console.error('[deletion] disableAuthAccount (queue):', id, error.code || error.message)
      })
    }
    return { pending: true, id: job.id }
  }

  async function eraseQuery(query) {
    const page = await query.limit(batchSize).get()
    if (page.empty) return true
    const batch = db.batch()
    page.docs.forEach((item) => batch.delete(item.ref))
    await batch.commit()
    return false
  }

  async function eraseStoragePrefix(prefix) {
    // Alguns harnesses legados não exercitam Storage e injetam apenas auth/db.
    // Em produção o bucket completo é sempre fornecido por functions/index.js.
    if (!bucket?.getFiles) return true
    const [files] = await bucket.getFiles({ prefix })
    await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })))
    return true
  }

  async function drainQuery(query) {
    while (!(await eraseQuery(query))) {
      // Keep draining this bounded, server-side deletion subtask before removing its owner lock.
    }
  }

  async function eraseProfessionalListing(uid) {
    const lockRef = db.doc(`professionalListingOwnerLocks/${uid}`)
    const lock = await lockRef.get()
    if (!lock.exists) return true
    const listingId = lock.data().listingId
    await Promise.all([
      eraseStoragePrefix(`professionalListingMedia/${listingId}/`),
      drainQuery(db.collection('showcaseReviewDecisions').where('listingId', '==', listingId)),
      drainQuery(db.collection('showcaseReports').where('listingId', '==', listingId)),
    ])
    const batch = db.batch()
    for (const path of [
      `publishedProfessionalListings/${listingId}`,
      `professionalListingDrafts/${listingId}`,
      `professionalListings/${listingId}`,
      `professionalListingOwnerLocks/${uid}`,
    ])
      batch.delete(db.doc(path))
    await batch.commit()
    return true
  }

  // A status is removed first; its deletion trigger queues a job that drains its
  // children. Child writes require the parent to exist and cannot race cleanup.
  //
  // Este batch.set (merge: true) e o queueDeleted() chamado pelo gatilho de exclusão de
  // statuses/{id} competem pelo mesmo job: quem chegar primeiro vence, e queueDeleted
  // desiste silenciosamente se o job já existir. Por isso photoPath precisa ser copiado
  // aqui também (usando o mesmo item.data() já lido nesta página) — sem isso, quando
  // este código ganha a corrida, o job de limpeza do status nasce sem saber que existe
  // uma foto pra apagar, e o arquivo só é removido bem depois, pela varredura de órfãos.
  async function removeStatuses(query) {
    const page = await query.limit(batchSize).get()
    if (page.empty) return true
    const batch = db.batch()
    page.docs.forEach((item) => {
      batch.delete(item.ref)
      batch.set(
        jobRef('status', item.id),
        {
          kind: 'status',
          targetId: item.id,
          state: 'pending',
          stage: 0,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          ...statusPhotoExtra(item.data()),
        },
        { merge: true }
      )
    })
    await batch.commit()
    return false
  }

  async function step(ref, { deadline = Date.now() + DEFAULT_STEP_BUDGET_MS } = {}) {
    const token = db.collection('deletionJobs').doc().id
    const job = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref)
      const data = snapshot.data()
      if (!data || data.state === 'complete' || data.leaseUntil?.toMillis() > Date.now())
        return null
      tx.update(ref, {
        leaseToken: token,
        leaseUntil: Timestamp.fromMillis(deadline + LEASE_BUFFER_MS),
      })
      return data
    })
    if (!job) return
    try {
      const uid = job.targetId
      // Fase 4 (EvoCash): portão financeiro, avaliado só antes da PRIMEIRA etapa
      // destrutiva (stage 0) -- nunca depois, o ponto de não-retorno já passou. Usa o
      // cashPurchaseLock (users/{uid}/wallet/cashPurchaseLock) em vez de uma query
      // userId+status: leitura de documento único, sem índice adicional, e é o mesmo
      // dado que já é a fonte de verdade de "existe uma compra pending" (ver
      // cash-purchase-service.js). Ficar bloqueado aqui NUNCA retenta a cada minuto: o
      // job sai do estado 'pending' (vira 'blocked_financial_review'), e a query de
      // processDeletionJobs em index.js já filtra state=='pending' -- some da fila
      // sozinho até confirmCashPurchase/cancelCashPurchase resolverem a pendência e
      // recolocá-lo em 'pending' (ver reactivateDeletionIfClear em
      // economy/cash-purchase-service.js).
      if (job.kind === 'account' && !job.stage) {
        const blocked = await db.runTransaction(async (tx) => {
          const current = await tx.get(ref)
          if (current.data()?.leaseToken !== token) return false
          const [lockSnapshot, walletSnapshot] = await tx.getAll(
            db.doc(`users/${uid}/wallet/cashPurchaseLock`),
            db.doc(`users/${uid}/wallet/current`)
          )
          const reason = financialBlockReason({
            pendingPurchaseId: lockSnapshot.exists ? lockSnapshot.data().pendingPurchaseId : null,
            cashBalance: walletSnapshot.exists ? walletSnapshot.data().cashBalance : 0,
          })
          if (!reason) return false
          tx.update(ref, {
            state: 'blocked_financial_review',
            blockReason: reason,
            leaseUntil: Timestamp.fromMillis(0),
            updatedAt: FieldValue.serverTimestamp(),
          })
          return true
        })
        if (blocked) {
          // Rede de segurança: quando o job já nasce bloqueado por revisão financeira,
          // o estágio 0 do array de tasks (montado abaixo) nunca chega a rodar -- o
          // bloqueio devolve antes disso. Normalmente a conta já foi desativada de
          // forma síncrona em queue(); isto só cobre o caso raro dessa chamada
          // best-effort ter falhado (rede etc.), pra nunca deixar uma conta bloqueada
          // sem essa proteção até um admin resolver a pendência e reabrir o job.
          await disableAuthAccount(uid).catch((error) => {
            console.error(
              '[deletion] disableAuthAccount (blocked):',
              uid,
              error.code || error.message
            )
          })
          return
        }
      }
      let tasks
      if (job.kind === 'account') {
        // supportRequests, moderationDecisions e moderationEvidence/*.webp
        // (Storage) NÃO entram nesta lista, de propósito: são o histórico de
        // moderação, preservado independente do destino da conta (denunciante,
        // denunciado ou alvo de um recurso). A evidência de foto já tem sua
        // própria política de retenção, ligada à decisão do chamado, não à conta
        // (ver EVIDENCE_PENDING_RETENTION_MS em functions/index.js) -- excluir a
        // conta não acelera nem adia esse prazo.
        tasks = [
          async () => {
            await disableAuthAccount(uid)
            return true
          },
          () => eraseQuery(db.collection('communityMembers').where('userId', '==', uid)),
          () => eraseQuery(db.collection('communityRestrictions').where('userId', '==', uid)),
          () => eraseQuery(db.collectionGroup('votes').where('userId', '==', uid)),
          () => eraseQuery(db.collectionGroup('participants').where('userId', '==', uid)),
          // Voto econômico (Fase 2): mesmo raciocínio do ledger de Coins acima -- sem
          // EvoCash, apagar o registro de quem votou não sustenta nenhuma compra real.
          () => eraseQuery(db.collectionGroup('economyVotes').where('userId', '==', uid)),
          () => removeStatuses(db.collection('statuses').where('authorId', '==', uid)),
          () => eraseQuery(db.collection('usernames').where('uid', '==', uid)),
          // economyTransactions (ledger) NÃO entra mais nesta lista a partir da Fase 4:
          // pode conter comprovante de dinheiro real (asset:'cash'), então apagar
          // apagaria auditoria financeira. Retenção declarada TEMPORÁRIA (também
          // preserva, de brinde, histórico social de EvoCoins que não precisaria de
          // retenção nenhuma) até existir uma política formal separando os dois. Já não
          // há risco de cashBalance>0 sumir junto com wallet/current aqui embaixo: o
          // portão financeiro acima bloqueia a exclusão inteira antes de chegar a esta
          // etapa enquanto cashBalance > 0.
          ...[
            'workouts',
            'exercises',
            'bodyMeasurements',
            'progressDaily',
            'legalAcceptances',
            'showcaseLegalAcceptances',
            'notices',
          ].map((name) => () => eraseQuery(db.collection(`users/${uid}/${name}`))),
          () => eraseQuery(db.collection(`users/${uid}/wallet`)),
          () => eraseQuery(db.collection(`users/${uid}/economyDaily`)),
          () => eraseQuery(db.collection(`publicProfiles/${uid}/statistics`)),
          () => eraseProfessionalListing(uid),
          async () => {
            await eraseStoragePrefix(`profileAvatars/${uid}/`)
            return eraseQuery(db.collection('profileAvatarMedia').where('ownerId', '==', uid))
          },
          async () => {
            try {
              await auth.deleteUser(uid)
            } catch (error) {
              if (error.code !== 'auth/user-not-found') throw error
            }
            return true
          },
          async () => {
            const batch = db.batch()
            for (const path of [
              `users/${uid}`,
              `publicProfiles/${uid}`,
              `accountRestrictions/${uid}`,
              `supportLimits/${uid}`,
              `rateLimitCounters/${uid}`,
              `showcaseReportRateLimits/${uid}`,
            ])
              batch.delete(db.doc(path))
            await batch.commit()
            return true
          },
        ]
      } else if (job.kind === 'community') {
        tasks = [
          () => eraseQuery(db.collection('communityMembers').where('communityId', '==', uid)),
          () => eraseQuery(db.collection('communityRestrictions').where('communityId', '==', uid)),
          () => removeStatuses(db.collection('statuses').where('communityId', '==', uid)),
          async () => {
            await db.doc(`communities/${uid}`).delete()
            return true
          },
        ]
      } else {
        // economyRewardDaily (Fase 3): contador de recompensa por dia deste post --
        // some junto com o post, mesma lista, sem custo extra (nenhum índice novo, é só
        // mais uma subcoleção varrida pelo mesmo eraseQuery já usado para as outras).
        tasks = ['votes', 'participants', 'economyVotes', 'economyRewardDaily'].map(
          (name) => () => eraseQuery(db.collection(`statuses/${uid}/${name}`))
        )
        // Só publicações do tipo foto carregam esse campo (ver queueDeleted em
        // index.js, que copia photoPath do documento apagado para o job). Apagar o
        // arquivo é sempre a última etapa, e ignoreNotFound cobre tanto uma nova
        // tentativa deste mesmo job quanto o caso raro de já ter sido removido.
        if (job.photoPath) {
          tasks.push(async () => {
            await bucket.file(job.photoPath).delete({ ignoreNotFound: true })
            return true
          })
        }
      }
      let stage = job.stage || 0
      // Processa quantas páginas/estágios couberem no orçamento de tempo (deadline),
      // não só uma página por chamada -- cada tarefa de eraseQuery/removeStatuses
      // apaga uma página (até batchSize docs) e devolve false enquanto ainda houver
      // mais; só avança de estágio quando a tarefa atual finalmente devolve true.
      while (stage < tasks.length && Date.now() < deadline) {
        if (await tasks[stage]()) stage++
      }
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref)
        if (current.data()?.leaseToken !== token) return
        tx.update(ref, {
          stage,
          state: stage === tasks.length ? 'complete' : 'pending',
          leaseUntil: Timestamp.fromMillis(0),
          lastError: null,
          ...(stage === tasks.length && job.kind !== 'account'
            ? { expireAt: Timestamp.fromMillis(Date.now() + 7 * 86400000) }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        })
      })
    } catch (error) {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref)
        if (current.data()?.leaseToken !== token) return
        tx.update(ref, {
          leaseUntil: Timestamp.fromMillis(0),
          lastError: String(error.code || 'internal'),
          updatedAt: FieldValue.serverTimestamp(),
        })
      })
      throw error
    }
  }

  async function queueDeleted(kind, id, extra = {}) {
    const ref = jobRef(kind, id)
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return
      tx.create(ref, {
        kind,
        targetId: id,
        state: 'pending',
        stage: 0,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        ...extra,
      })
    })
  }

  // Único jeito seguro do cliente aprender o próprio estado de exclusão: deletionJobs
  // não tem NENHUMA regra de leitura pro dono (ver firestore.rules -- só é referenciado
  // dentro de exists() por outras regras, nunca lido direto), e mesmo que tivesse,
  // blockReason/saldo são dado financeiro privado que não deveria ser exposto pra
  // explicar um permission-denied. Só os dois estados que precisam de uma tela dedicada
  // no cliente (AccountDeletionBlockedGate / logout com mensagem específica de
  // "exclusão em processamento") -- 'complete' e "sem job nenhum" caem no mesmo
  // tratamento de sempre (getIdToken(true) + nova tentativa da leitura, ver
  // handlePossibleGhostSession em AuthContext.jsx), então não precisam ser
  // diferenciados aqui.
  async function getOwnStatus(uid) {
    const snapshot = await jobRef('account', uid).get()
    const state = snapshot.data()?.state
    return { state: state === 'pending' || state === 'blocked_financial_review' ? state : null }
  }
  return { queue, step, queueDeleted, getOwnStatus }
}
