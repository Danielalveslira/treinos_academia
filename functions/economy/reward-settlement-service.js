import { evaluateAuthorEligibility, planSettlementBatch, rewardSettlementNaturalKey } from './reward-settlement-core.js'

// Descoberta e promoção limitadas para caber num timeoutSeconds generoso (300s, mesmo
// padrão de processDeletionJobs) mesmo no pior caso -- ver auditoria de Fase 3 para o
// cálculo de custo por trecho.
const DISCOVERY_LIMIT = 200
// Reduzido de 50 para 25 porque, preservando a ordem GLOBAL (não reagrupada por autor),
// uma única transação de settlement pode tocar vários autores distintos -- o pior caso
// (todo mundo diferente: autor, post, votante) dobra o número de documentos distintos
// por voto em relação a um lote de 1 autor só. 25 mantém o pior caso (~150 writes) na
// mesma margem seguraa que 50 votos de 1 autor só tinha antes.
const CHUNK_SIZE = 25
const PROMOTION_LIMIT = 100

// timeoutSeconds REAL da Cloud Function agendada (functions/index.js importa esta
// constante em vez de repetir o número, exatamente para que os dois nunca possam
// divergir silenciosamente).
export const SETTLEMENT_FUNCTION_TIMEOUT_SECONDS = 300
// Margem de segurança acima do timeout real da function.
//
// Auditoria operacional: o lease é adquirido/liberado UMA VEZ por execução inteira,
// sem renovação (ver acquireLease/releaseLease). Isso só é seguro se a duração do
// lease for ESTRITAMENTE MAIOR que o tempo máximo que uma execução pode ficar rodando
// -- senão o lease expiraria enquanto uma execução ainda "autorizada" (correndo dentro
// do próprio timeoutSeconds) segue processando, permitindo que uma segunda execução
// adquira o mesmo lease e processe a MESMA fila ordenada em paralelo. A margem de 60s
// cobre a folga entre o Cloud Functions matar a execução por timeout (que NÃO passa
// pelo `finally { releaseLease() }`, já que o processo é encerrado à força) e o lease
// realmente ficar livre para a próxima tentativa. Bug corrigido nesta auditoria: o
// valor anterior (4min) era MENOR que os 300s (5min) de timeoutSeconds -- o oposto do
// que a garantia exige.
const LEASE_SAFETY_MARGIN_MS = 60 * 1000
export const LEASE_DURATION_MS = SETTLEMENT_FUNCTION_TIMEOUT_SECONDS * 1000 + LEASE_SAFETY_MARGIN_MS

function voteKeyOf(statusId, voterId) {
  return `${statusId}:${voterId}`
}

function parseVotePath(path) {
  // statuses/{statusId}/economyVotes/{voterId}
  const parts = path.split('/')
  return { statusId: parts[1], voterId: parts[3] }
}

// HttpsError não é necessário aqui (função de scheduler, sem chamador HTTP a avisar) --
// falhas viram exceções normais, que o Cloud Functions já reporta/reexecuta sozinho.
export function createRewardSettlementService({
  db,
  FieldValue,
  Timestamp,
  wallet,
  ledger,
  getEconomyConfig,
  now = Date.now,
  discoveryLimit = DISCOVERY_LIMIT,
  chunkSize = CHUNK_SIZE,
  promotionLimit = PROMOTION_LIMIT,
  leaseDurationMs = LEASE_DURATION_MS,
}) {
  const lockRef = db.doc('maintenance/rewardSettlementLock')

  // Lease adquirido/liberado UMA VEZ por execução inteira (nunca por voto/chunk) --
  // impede duas execuções do scheduler se sobrepondo e processando a mesma fila
  // ordenada em paralelo, o que quebraria a garantia de ordem global entre execuções.
  // Expiração cobre recuperação de crash (se a function morrer no meio, o lease vence
  // sozinho e a próxima execução agendada retoma).
  async function acquireLease() {
    const token = db.collection('maintenance').doc().id
    const nowMs = now()
    const acquired = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(lockRef)
      const data = snapshot.data()
      if (data?.leaseUntil?.toMillis() > nowMs) return false
      tx.set(lockRef, {
        leaseToken: token,
        leaseUntil: Timestamp.fromMillis(nowMs + leaseDurationMs),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return true
    })
    return acquired ? token : null
  }

  async function releaseLease(token) {
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(lockRef)
      // Só libera o PRÓPRIO lease -- se já expirou e outra execução o retomou, liberar
      // aqui destruiria o lease legítimo dela.
      if (snapshot.data()?.leaseToken !== token) return
      tx.update(lockRef, { leaseUntil: Timestamp.fromMillis(0) })
    })
  }

  // Promoção deferred -> pending: RELÊ cada voto DENTRO de uma transação e exige
  // rewardState==='deferred', value===1 e rewardRetryAt<=now antes de mudar qualquer
  // coisa -- nunca um db.batch() sobre o snapshot puro da query (isso teria uma corrida
  // real com o votante trocando/removendo o voto entre a query e a escrita). Preserva
  // rewardPendingAt (o evento elegível original, não muda só por causa da promoção).
  async function promoteDeferredVotes() {
    const nowMs = now()
    const snapshot = await db
      .collectionGroup('economyVotes')
      .where('rewardState', '==', 'deferred')
      .where('rewardRetryAt', '<=', Timestamp.fromMillis(nowMs))
      .limit(promotionLimit)
      .get()
    if (snapshot.empty) return { promoted: 0 }

    let promoted = 0
    const refs = snapshot.docs.map((d) => d.ref)
    await db.runTransaction(async (tx) => {
      const freshSnapshots = await tx.getAll(...refs)
      for (const fresh of freshSnapshots) {
        if (!fresh.exists) continue
        const data = fresh.data()
        if (data.rewardState !== 'deferred' || data.value !== 1) continue
        const retryAtMs = data.rewardRetryAt?.toMillis ? data.rewardRetryAt.toMillis() : null
        if (retryAtMs == null || retryAtMs > nowMs) continue
        tx.set(
          fresh.ref,
          { rewardState: 'pending', rewardRetryAt: null, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
        promoted++
      }
    })
    return { promoted }
  }

  async function processChunk(chunkRefs, limits, nowMs) {
    return db.runTransaction(async (tx) => {
      // ================= FASE DE LEITURA (nada é escrito antes daqui terminar) =================
      const voteSnapshots = await tx.getAll(...chunkRefs)

      // Relê cada voto fresco -- descarta quem já não é mais pending/positivo (corrida
      // com o próprio votante, ou com outra execução que já tenha processado este
      // mesmo voto antes do nosso lease existir).
      const candidates = []
      for (const snap of voteSnapshots) {
        if (!snap.exists) continue
        const data = snap.data()
        if (data.rewardState !== 'pending' || data.value !== 1) continue
        const { statusId, voterId } = parseVotePath(snap.ref.path)
        candidates.push({
          ref: snap.ref,
          voteKey: voteKeyOf(statusId, voterId),
          statusId,
          voterId,
          authorId: data.authorId,
          rewardDayKey: data.rewardDayKey,
        })
      }
      if (candidates.length === 0) return { processed: 0, capped: 0, deferred: 0 }

      // ---- elegibilidade do autor (por autor distinto) ----
      const distinctAuthorIds = [...new Set(candidates.map((c) => c.authorId))]
      const authorEligibilityRefs = distinctAuthorIds.flatMap((id) => [
        db.doc(`deletionJobs/account_${id}`),
        db.doc(`accountRestrictions/${id}`),
      ])
      const authorEligibilitySnapshots = authorEligibilityRefs.length
        ? await tx.getAll(...authorEligibilityRefs)
        : []
      const authorEligibilityByAuthorId = {}
      distinctAuthorIds.forEach((id, index) => {
        const deletionSnap = authorEligibilitySnapshots[index * 2]
        const restrictionSnap = authorEligibilitySnapshots[index * 2 + 1]
        authorEligibilityByAuthorId[id] = evaluateAuthorEligibility({
          deletionJobExists: deletionSnap.exists,
          restriction: restrictionSnap.exists ? restrictionSnap.data() : null,
          nowMs,
        })
      })

      // ---- status: existência + autor esperado (por status distinto) ----
      const distinctStatusIds = [...new Set(candidates.map((c) => c.statusId))]
      const statusRefs = distinctStatusIds.map((id) => db.doc(`statuses/${id}`))
      const statusSnapshots = statusRefs.length ? await tx.getAll(...statusRefs) : []
      const statusAuthorByStatusId = {}
      distinctStatusIds.forEach((id, index) => {
        const snap = statusSnapshots[index]
        statusAuthorByStatusId[id] = snap.exists ? snap.data().authorId : null
      })

      // ---- contador por post/dia (statuses/{id}/economyRewardDaily/{day}) ----
      const postDayRefs = new Map() // "statusId|day" -> ref
      for (const c of candidates) {
        const key = `${c.statusId}|${c.rewardDayKey}`
        if (!postDayRefs.has(key)) {
          postDayRefs.set(key, db.doc(`statuses/${c.statusId}/economyRewardDaily/${c.rewardDayKey}`))
        }
      }
      const postDayKeys = [...postDayRefs.keys()]
      const postDaySnapshots = postDayKeys.length
        ? await tx.getAll(...postDayKeys.map((k) => postDayRefs.get(k)))
        : []
      const postDayCoins = {}
      postDayKeys.forEach((key, index) => {
        postDayCoins[key] = postDaySnapshots[index].exists
          ? postDaySnapshots[index].data().coinsCredited || 0
          : 0
      })

      // ---- economyDaily (autor E votante -- MESMO tipo de documento, unificado num só
      // mapa de refs pra nunca ler o mesmo uid/dia duas vezes, mesmo quando o mesmo uid
      // aparece como autor de um voto e votante de outro no mesmo chunk) ----
      const economyDailyRefs = new Map() // "uid|day" -> ref
      for (const c of candidates) {
        const authorKey = `${c.authorId}|${c.rewardDayKey}`
        if (!economyDailyRefs.has(authorKey)) {
          economyDailyRefs.set(authorKey, db.doc(`users/${c.authorId}/economyDaily/${c.rewardDayKey}`))
        }
        const voterKey = `${c.voterId}|${c.rewardDayKey}`
        if (!economyDailyRefs.has(voterKey)) {
          economyDailyRefs.set(voterKey, db.doc(`users/${c.voterId}/economyDaily/${c.rewardDayKey}`))
        }
      }
      const economyDailyKeys = [...economyDailyRefs.keys()]
      const economyDailySnapshots = economyDailyKeys.length
        ? await tx.getAll(...economyDailyKeys.map((k) => economyDailyRefs.get(k)))
        : []
      const economyDailyData = {}
      economyDailyKeys.forEach((key, index) => {
        economyDailyData[key] = economyDailySnapshots[index].exists ? economyDailySnapshots[index].data() : null
      })

      // ================= DECISÃO (pura, em memória, sem I/O) =================
      const votesForCore = candidates.map((c) => ({
        voteKey: c.voteKey,
        authorId: c.authorId,
        voterId: c.voterId,
        statusId: c.statusId,
        rewardDayKey: c.rewardDayKey,
        statusEligible: statusAuthorByStatusId[c.statusId] === c.authorId,
        authorEligibility: authorEligibilityByAuthorId[c.authorId],
      }))

      const initialCounters = {
        postDaily: postDayCoins,
        authorDaily: Object.fromEntries(
          candidates
            .map((c) => `${c.authorId}|${c.rewardDayKey}`)
            .filter((key, i, arr) => arr.indexOf(key) === i)
            .map((key) => [key, economyDailyData[key]?.authorRewardCoins || 0])
        ),
        voterAuthorDaily: Object.fromEntries(
          candidates
            .map((c) => `${c.voterId}|${c.rewardDayKey}|${c.authorId}`)
            .filter((key, i, arr) => arr.indexOf(key) === i)
            .map((key) => {
              const [voterId, day, authorId] = key.split('|')
              const count = economyDailyData[`${voterId}|${day}`]?.authorRewardCounts?.[authorId] || 0
              return [key, count]
            })
        ),
        voterDaily: Object.fromEntries(
          candidates
            .map((c) => `${c.voterId}|${c.rewardDayKey}`)
            .filter((key, i, arr) => arr.indexOf(key) === i)
            .map((key) => [key, economyDailyData[key]?.rewardedVotesGiven || 0])
        ),
      }

      const plan = planSettlementBatch({ votes: votesForCore, initialCounters, limits })

      // ---- wallet + ledger check, só para autores efetivamente creditados neste chunk ----
      const creditedAuthorIds = Object.keys(plan.authorCredits)
      const walletByAuthorId = {}
      const naturalKeyByAuthorId = {}
      const alreadyLedgeredByAuthorId = {}
      for (const authorId of creditedAuthorIds) {
        walletByAuthorId[authorId] = await wallet.getWallet(tx, authorId)
        const naturalKey = rewardSettlementNaturalKey(plan.authorCredits[authorId].voteKeys)
        naturalKeyByAuthorId[authorId] = naturalKey
        alreadyLedgeredByAuthorId[authorId] = await ledger.alreadyRecorded(tx, authorId, naturalKey)
      }

      // ================= FASE DE ESCRITA (nenhuma leitura depois daqui) =================

      // Consolidação por documento REAL: acumula todos os deltas (papel de autor E de
      // votante, quando o mesmo uid/dia aparece nos dois) num único objeto por chave
      // ANTES de emitir qualquer tx.set() -- múltiplos tx.set() para o MESMO documento
      // na mesma transação não se somam (o último sobrescreve os anteriores), então
      // isto precisa ser 1 write por documento, nunca mais. authorRewardCounts é um
      // MAPA aninhado: uma chave de campo com ponto (ex.: "authorRewardCounts.abc") NÃO
      // é confiável como caminho aninhado num set({merge:true}) do Admin SDK -- em vez
      // disso, o mapa final é calculado aqui em JS a partir do valor já lido
      // (economyDailyData) e gravado por inteiro.
      const dailyPayloads = new Map() // "uid|day" -> { simple: {campo: delta}, mapIncrements: {authorId: delta} }
      function ensureDailyEntry(key) {
        if (!dailyPayloads.has(key)) dailyPayloads.set(key, { simple: {}, mapIncrements: {} })
        return dailyPayloads.get(key)
      }
      for (const [key, delta] of Object.entries(plan.authorDeltas)) {
        const entry = ensureDailyEntry(key)
        entry.simple.authorRewardCoins = (entry.simple.authorRewardCoins || 0) + delta
      }
      for (const [key, delta] of Object.entries(plan.voterDeltas)) {
        const entry = ensureDailyEntry(key)
        entry.simple.rewardedVotesGiven = (entry.simple.rewardedVotesGiven || 0) + delta
      }
      for (const [key, delta] of Object.entries(plan.voterAuthorDeltas)) {
        const [voterId, day, authorId] = key.split('|')
        const entry = ensureDailyEntry(`${voterId}|${day}`)
        entry.mapIncrements[authorId] = (entry.mapIncrements[authorId] || 0) + delta
      }
      for (const [key, { simple, mapIncrements }] of dailyPayloads) {
        const ref = economyDailyRefs.get(key)
        const payload = { updatedAt: FieldValue.serverTimestamp() }
        for (const [field, delta] of Object.entries(simple)) payload[field] = FieldValue.increment(delta)
        if (Object.keys(mapIncrements).length > 0) {
          const mergedMap = { ...(economyDailyData[key]?.authorRewardCounts || {}) }
          for (const [authorId, delta] of Object.entries(mapIncrements)) {
            mergedMap[authorId] = (mergedMap[authorId] || 0) + delta
          }
          payload.authorRewardCounts = mergedMap
        }
        tx.set(ref, payload, { merge: true })
      }

      // Post/dia: coleção própria (statuses/{id}/economyRewardDaily), nunca colide com
      // economyDaily de usuário -- sem risco de merge cruzado, escrito à parte.
      for (const [key, delta] of Object.entries(plan.postDeltas)) {
        tx.set(
          postDayRefs.get(key),
          { coinsCredited: FieldValue.increment(delta), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
      }

      // Wallet + ledger, só para quem realmente vai ser creditado (e cuja chave natural
      // ainda não existe -- defesa extra, não deveria disparar dado o resto do desenho).
      const skippedAuthorIds = new Set()
      for (const authorId of creditedAuthorIds) {
        if (alreadyLedgeredByAuthorId[authorId]) {
          skippedAuthorIds.add(authorId)
          continue
        }
        const { amount, voteKeys } = plan.authorCredits[authorId]
        wallet.creditCoins(tx, authorId, walletByAuthorId[authorId], amount)
        ledger.record(tx, authorId, naturalKeyByAuthorId[authorId], {
          asset: 'coin',
          direction: 'credit',
          amount,
          reason: 'vote_reward_settlement',
          referenceType: 'vote_batch',
          referenceId: voteKeys.join(','),
        })
      }

      // Estado final de cada voto -- 'processed'/'capped' ganham rewardSettledAt;
      // 'deferred' preserva rewardPendingAt (nunca reescrito aqui) e só grava
      // rewardRetryAt. Um voto cujo autor "já estava ledgerado" (caso defensivo acima)
      // não é tocado agora -- continua pending, será reavaliado do zero na próxima
      // execução em vez de arriscar um estado inconsistente.
      let processedCount = 0
      let cappedCount = 0
      let deferredCount = 0
      for (const outcome of plan.outcomes) {
        const candidate = candidates.find((c) => c.voteKey === outcome.voteKey)
        if (outcome.outcome === 'processed') {
          if (skippedAuthorIds.has(candidate.authorId)) continue
          tx.set(
            candidate.ref,
            { rewardState: 'processed', rewardSettledAt: FieldValue.serverTimestamp() },
            { merge: true }
          )
          processedCount++
        } else if (outcome.outcome === 'capped') {
          tx.set(
            candidate.ref,
            {
              rewardState: 'capped',
              rewardCappedReason: outcome.reason,
              rewardSettledAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          )
          cappedCount++
        } else if (outcome.outcome === 'deferred') {
          tx.set(
            candidate.ref,
            {
              rewardState: 'deferred',
              rewardRetryAt: Timestamp.fromMillis(outcome.retryAt),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          )
          deferredCount++
        }
      }

      return { processed: processedCount, capped: cappedCount, deferred: deferredCount }
    })
  }

  async function runSettlementPass() {
    const nowMs = now()
    const config = await getEconomyConfig()
    const limits = config.voting

    // Ordem GLOBAL explícita: rewardPendingAt asc (o dia do EVENTO, não de execução) +
    // desempate por documentId -- preservada até a decisão final (ver
    // reward-settlement-core.js: os votos nunca são reagrupados por autor antes de
    // decidir). Índice necessário: economyVotes, collection group, [rewardState ASC,
    // rewardPendingAt ASC].
    const discoverySnapshot = await db
      .collectionGroup('economyVotes')
      .where('rewardState', '==', 'pending')
      .orderBy('rewardPendingAt', 'asc')
      .orderBy('__name__', 'asc')
      .limit(discoveryLimit)
      .get()

    const orderedRefs = discoverySnapshot.docs.map((d) => d.ref)
    // Observabilidade (auditoria operacional): idade do voto mais antigo no TOPO da
    // fila nesta execução -- proxy direto de atraso/backlog (quanto maior, mais a
    // descoberta está atrasada em relação ao momento em que os votos ficaram
    // elegíveis). Medido no início do lote, independente do resultado final de cada
    // voto (processed/capped/deferred) -- reler o rewardPendingAt do primeiro item já
    // ordenado (rewardPendingAt asc) é suficiente, não precisa de nenhuma leitura extra.
    const oldestPendingAgeMs = discoverySnapshot.docs.length
      ? nowMs - discoverySnapshot.docs[0].data().rewardPendingAt.toMillis()
      : 0
    let processed = 0
    let capped = 0
    let deferred = 0
    // Chunks processados SEQUENCIALMENTE, nunca em paralelo -- o chunk seguinte precisa
    // enxergar os contadores já incrementados pelo anterior pra a ordem global continuar
    // valendo entre fatias, não só dentro de uma.
    for (let i = 0; i < orderedRefs.length; i += chunkSize) {
      const chunkRefs = orderedRefs.slice(i, i + chunkSize)
      const result = await processChunk(chunkRefs, limits, nowMs)
      processed += result.processed
      capped += result.capped
      deferred += result.deferred
    }

    return { discovered: orderedRefs.length, processed, capped, deferred, oldestPendingAgeMs }
  }

  // Observabilidade (auditoria operacional, seção 3): durationMs cobre a execução
  // INTEIRA, inclusive o release do lease no finally -- assim também serve de sinal de
  // alerta caso algum dia se aproxime perigosamente de SETTLEMENT_FUNCTION_TIMEOUT_SECONDS.
  // "Conflitos de lease" (uma execução que encontrou o lease já ocupado) já aparecem
  // aqui como skipped:true -- basta logar todo resultado (ver functions/index.js), não
  // só o caminho feliz, para o conflito virar visível/contável nos logs estruturados.
  async function settleVoteRewards() {
    const startMs = now()
    const leaseToken = await acquireLease()
    if (!leaseToken) {
      return { skipped: true, reason: 'lease_held', durationMs: now() - startMs }
    }
    let result
    try {
      const promotion = await promoteDeferredVotes()
      const settlement = await runSettlementPass()
      result = { skipped: false, promoted: promotion.promoted, ...settlement }
    } finally {
      await releaseLease(leaseToken)
    }
    return { ...result, durationMs: now() - startMs }
  }

  // acquireLease/releaseLease pendurados na própria function (não expostos como um
  // segundo valor de retorno "oficial") para manter TODO chamador existente
  // (functions/index.js e os ~16 testes deste arquivo que já tratam o retorno de
  // createRewardSettlementService como uma função direta) funcionando sem nenhuma
  // mudança -- só a auditoria operacional (teste de posse do lease) precisa deles.
  settleVoteRewards.acquireLease = acquireLease
  settleVoteRewards.releaseLease = releaseLease
  return settleVoteRewards
}
