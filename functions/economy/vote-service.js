import { decideVoteAction, nextRewardState } from './vote-core.js'
import { todayKey } from './activity-core.js'

// voteOnPost -- seção 13 do prompt de economia (voto atômico). HttpsError injetado
// (mesmo padrão de deletion-service.js) em vez de importado direto: mantém este arquivo
// testável sem depender do runtime de Cloud Functions.
export function createVoteService({
  db,
  FieldValue,
  wallet,
  ledger,
  getEconomyConfig,
  assertWritableAccount,
  HttpsError,
  now = Date.now,
}) {
  return async function voteOnPost(uid, statusId, incomingValue) {
    const statusRef = db.doc(`statuses/${statusId}`)
    const voteRef = db.doc(`statuses/${statusId}/economyVotes/${uid}`)

    return db.runTransaction(async (tx) => {
      await assertWritableAccount(tx, uid)

      const statusSnapshot = await tx.get(statusRef)
      if (!statusSnapshot.exists) {
        throw new HttpsError('not-found', 'Publicação não encontrada.')
      }
      const status = statusSnapshot.data()
      if (status.authorId === uid) {
        throw new HttpsError('failed-precondition', 'Você não pode votar na própria publicação.')
      }
      const nowMs = now()
      if (status.expiresAt?.toMillis() <= nowMs) {
        throw new HttpsError('failed-precondition', 'Esta publicação já expirou.')
      }

      // "usuário pode votar?" (seção 13): mesma barreira de acesso do voto de enquete
      // gratuito já existente (canVote/isMember em firestore.rules) -- membro da
      // comunidade, sem restrição de comunidade, sem restrição de conta ativa. Aplicada
      // a QUALQUER ação (inclusive remover/trocar um voto já pago): uma conta banida não
      // deveria continuar interagindo com o conteúdo da comunidade de jeito nenhum.
      const membershipRef = db.doc(`communityMembers/${status.communityId}_${uid}`)
      const communityRestrictionRef = db.doc(`communityRestrictions/${status.communityId}_${uid}`)
      const accountRestrictionRef = db.doc(`accountRestrictions/${uid}`)
      const [membershipSnapshot, communityRestrictionSnapshot, accountRestrictionSnapshot, voteSnapshot] =
        await tx.getAll(membershipRef, communityRestrictionRef, accountRestrictionRef, voteRef)

      if (!membershipSnapshot.exists) {
        throw new HttpsError('permission-denied', 'Você não participa desta comunidade.')
      }
      if (communityRestrictionSnapshot.exists) {
        throw new HttpsError('permission-denied', 'Você está impedido de interagir nesta comunidade.')
      }
      if (accountRestrictionSnapshot.exists) {
        const restriction = accountRestrictionSnapshot.data()
        const suspensionExpired =
          restriction.action === 'temporary_suspension' && restriction.until?.toMillis() <= nowMs
        if (!suspensionExpired) {
          throw new HttpsError('permission-denied', 'Sua conta está com uma restrição ativa.')
        }
      }

      const existingVote = voteSnapshot.exists ? voteSnapshot.data() : null
      const { action } = decideVoteAction({ existingVote, incomingValue })

      if (action === 'noop') {
        return { voted: false, action: 'noop' }
      }

      // 'switch' e 'remove': o pagamento já aconteceu uma vez para esta publicação
      // (charged=true é permanente, ver vote-core.js) -- só o valor/estado de recompensa
      // mudam, nunca a carteira, o ledger ou o limite diário.
      if (action !== 'create') {
        const nextState = nextRewardState(existingVote.rewardState, incomingValue)
        // rewardPendingAt/rewardDayKey marcam O EVENTO ELEGÍVEL (seção 2 da auditoria de
        // Fase 3): o settlement usa o dia deste carimbo, nunca o dia em que ele rodou.
        // Uma entrada FRESCA em pending (vindo de ineligible/deferred, nunca de já estar
        // pending -- decideVoteAction trata "mesmo valor de novo" como noop antes de
        // chegar aqui) é um evento elegível NOVO, carimbado agora. Virar ineligible limpa
        // os três campos -- não sobra lixo que o settlement possa ler por engano (ele só
        // lê votos com rewardState pending/deferred, mas manter isto limpo evita confusão
        // numa auditoria manual).
        const enteringPending = nextState === 'pending' && existingVote.rewardState !== 'pending'
        tx.set(voteRef, {
          userId: uid,
          authorId: status.authorId,
          value: incomingValue,
          charged: true,
          firstChargedAt: existingVote.firstChargedAt,
          updatedAt: FieldValue.serverTimestamp(),
          rewardState: nextState,
          ...(enteringPending
            ? { rewardPendingAt: FieldValue.serverTimestamp(), rewardDayKey: todayKey(nowMs), rewardRetryAt: null }
            : nextState === 'ineligible'
              ? { rewardPendingAt: null, rewardDayKey: null, rewardRetryAt: null }
              : {}),
        })
        return { voted: true, action, charged: false }
      }

      // action === 'create': primeiro voto do usuário nesta publicação -- só aqui existe
      // cobrança, limite diário e ledger (seção 12).
      const config = await getEconomyConfig()
      const { costCoins, maxVotesPerUserDay } = config.voting
      const dateKey = todayKey(nowMs)
      const dailyRef = db.doc(`users/${uid}/economyDaily/${dateKey}`)
      const dailySnapshot = await tx.get(dailyRef)
      const daily = dailySnapshot.exists ? dailySnapshot.data() : null
      const votesChargedToday = daily?.votesCharged || 0
      if (votesChargedToday >= maxVotesPerUserDay) {
        throw new HttpsError('resource-exhausted', 'Limite diário de votos atingido.')
      }

      const currentWallet = await wallet.getWallet(tx, uid)
      if (currentWallet.coinBalance < costCoins) {
        throw new HttpsError('failed-precondition', 'Saldo de EvoCoins insuficiente para votar.')
      }

      // Mesma trava dupla de idempotência de activity-service.js: charged=true (recém
      // decidido acima via decideVoteAction) já deveria bastar, o ledger é a rede de
      // segurança extra contra uma reexecução que visse o voto ainda não criado.
      const naturalKey = `vote:${statusId}:charge`
      const alreadyLedgered = await ledger.alreadyRecorded(tx, uid, naturalKey)
      if (!alreadyLedgered) {
        wallet.debitCoins(tx, uid, currentWallet, costCoins)
        ledger.record(tx, uid, naturalKey, {
          asset: 'coin',
          direction: 'debit',
          amount: costCoins,
          reason: 'vote_cast',
          referenceType: 'status',
          referenceId: statusId,
        })
        tx.set(
          dailyRef,
          {
            votesCharged: votesChargedToday + 1,
            voteCoinsSpent: (daily?.voteCoinsSpent || 0) + costCoins,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
      }

      const createRewardState = nextRewardState(null, incomingValue)
      tx.set(voteRef, {
        userId: uid,
        authorId: status.authorId,
        value: incomingValue,
        charged: true,
        firstChargedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        rewardState: createRewardState,
        // Primeiro voto positivo já nasce com o evento elegível carimbado (mesma lógica
        // do ramo switch/remove acima) -- um voto negativo não tem rewardPendingAt/
        // rewardDayKey nenhum, nunca é lido pelo settlement mesmo.
        ...(createRewardState === 'pending'
          ? { rewardPendingAt: FieldValue.serverTimestamp(), rewardDayKey: dateKey }
          : {}),
      })

      return { voted: true, action: 'create', charged: !alreadyLedgered, costCoins }
    })
  }
}
