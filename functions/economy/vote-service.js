import {
  decideVoteAction,
  nextRewardState,
  economyVoteCountDelta,
  economyVoteIneligibility,
} from './vote-core.js'
import { todayKey } from './activity-core.js'

// voteOnPost -- seção 13 do prompt de economia (voto atômico). HttpsError injetado
// (mesmo padrão de deletion-service.js) em vez de importado direto: mantém este arquivo
// testável sem depender do runtime de Cloud Functions.
//
// Leituras agrupadas via tx.getAll() (auditoria de latência: Firestore em nam5,
// Function em southamerica-east1 -- cada round trip cross-região é caro, então o número
// de round trips importa mais que o número de documentos por si só). Versão
// CONSERVADORA (nunca lê wallet/daily/ledger fora do branch que realmente precisa
// deles -- switch/remove/noop não ganham nenhuma leitura nova nem entram no read set
// desses documentos):
//
//   batch 1: deletionJobRef + statusRef -- os dois únicos documentos que não dependem
//   de nada além de uid/statusId (os argumentos da própria função).
//
//   batch 2: membershipRef/communityRestrictionRef (dependem de status.communityId, só
//   conhecido depois do batch 1) + accountRestrictionRef + voteRef. Com isto já dá pra
//   decidir noop/switch/remove/create -- switch/remove/noop terminam aqui, em 2 round
//   trips de leitura, sem nunca tocar em wallet/daily/ledger.
//
//   batch 3 (só quando action === 'create'): dailyRef + walletRef + ledgerRef --
//   sempre os 3 juntos (aceito ler wallet/ledger antes de saber se o limite diário
//   bloqueia), mas só quando a ação É de fato 'create'. 3º round trip só neste branch.
//
// Nenhuma regra de negócio muda: mesma ordem de validação/erros, mesma cobrança, mesmo
// ledger, mesma idempotência, mesmos contadores -- só ONDE cada tx.get() acontece.
export function createVoteService({
  db,
  FieldValue,
  wallet,
  ledger,
  getEconomyConfig,
  // Não é mais chamada aqui -- seu único efeito (checar deletionJobs/account_{uid}) é
  // replicado inline abaixo, agrupado com a leitura de status no batch 1. Chamá-la
  // seria um tx.get() isolado, reintroduzindo exatamente o round trip que este
  // refactor existe para eliminar. Mantido como parâmetro só por compatibilidade com o
  // mesmo formato de injeção de dependência dos outros serviços econômicos/dos testes.
  // eslint-disable-next-line no-unused-vars -- mantido só por compatibilidade, ver comentário acima
  assertWritableAccount: _assertWritableAccount,
  HttpsError,
  now = Date.now,
}) {
  return async function voteOnPost(uid, statusId, incomingValue) {
    const statusRef = db.doc(`statuses/${statusId}`)
    const voteRef = db.doc(`statuses/${statusId}/economyVotes/${uid}`)
    const deletionJobRef = db.doc(`deletionJobs/account_${uid}`)

    return db.runTransaction(async (tx) => {
      // batch 1 (1 round trip): nada aqui depende de status.communityId.
      const [deletionJobSnapshot, statusSnapshot] = await tx.getAll(deletionJobRef, statusRef)

      if (deletionJobSnapshot.exists) {
        throw new HttpsError('failed-precondition', 'A conta está em exclusão.')
      }
      if (!statusSnapshot.exists) {
        throw new HttpsError('not-found', 'Publicação não encontrada.')
      }
      const status = statusSnapshot.data()
      // Esta barreira roda antes de ler carteira/limite/ledger e antes de qualquer
      // contador ou documento de voto ser alterado. voteOnPost e voteOnPostV2 usam a
      // mesma instância deste serviço, portanto não existe divergência entre endpoints.
      const ineligibility = economyVoteIneligibility(status.type)
      if (ineligibility) throw new HttpsError('failed-precondition', ineligibility)
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

      // batch 2 (1 round trip): o suficiente para decidir noop/switch/remove/create.
      const [
        membershipSnapshot,
        communityRestrictionSnapshot,
        accountRestrictionSnapshot,
        voteSnapshot,
      ] = await tx.getAll(membershipRef, communityRestrictionRef, accountRestrictionRef, voteRef)

      if (!membershipSnapshot.exists) {
        throw new HttpsError('permission-denied', 'Você não participa desta comunidade.')
      }
      if (communityRestrictionSnapshot.exists) {
        throw new HttpsError(
          'permission-denied',
          'Você está impedido de interagir nesta comunidade.'
        )
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

      // "Ver quem votou" -- positiveVoteCount/negativeVoteCount em statuses/{id},
      // atualizados na MESMA transação (nunca por um gatilho Firestore separado:
      // gatilhos podem ser reentregues, e FieldValue.increment não é idempotente --
      // uma reentrega contaria a mesma troca de voto duas vezes, causando drift
      // permanente). Como toda mudança de `value` já passa por aqui, não existe
      // nenhuma escrita de voto fora desta transação para perder. increment() num
      // campo ainda ausente (posts anteriores a este campo) simplesmente o cria com o
      // delta -- corrigir a contagem histórica desses posts é responsabilidade do
      // backfill único (scripts/backfill-economy-vote-counts.mjs), não desta função.
      //
      // Cálculo do delta fica aqui (puro, sem I/O), mas a ESCRITA (tx.update) só
      // acontece depois de cada branch já ter feito todas as leituras que precisa --
      // Firestore exige todas as leituras de uma transação antes de qualquer escrita.
      const { positiveDelta, negativeDelta } = economyVoteCountDelta(
        existingVote ? existingVote.value : null,
        incomingValue
      )
      function applyVoteCountDelta() {
        tx.update(statusRef, {
          positiveVoteCount: FieldValue.increment(positiveDelta),
          negativeVoteCount: FieldValue.increment(negativeDelta),
        })
      }

      // 'switch' e 'remove': o pagamento já aconteceu uma vez para esta publicação
      // (charged=true é permanente, ver vote-core.js) -- só o valor/estado de recompensa
      // mudam, nunca a carteira, o ledger ou o limite diário. Nenhuma leitura nova
      // acontece daqui pra frente neste branch (nem wallet, nem daily, nem ledger --
      // de propósito, ver comentário no topo do arquivo), então a escrita do contador
      // já pode ir.
      if (action !== 'create') {
        applyVoteCountDelta()
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
            ? {
                rewardPendingAt: FieldValue.serverTimestamp(),
                rewardDayKey: todayKey(nowMs),
                rewardRetryAt: null,
              }
            : nextState === 'ineligible'
              ? { rewardPendingAt: null, rewardDayKey: null, rewardRetryAt: null }
              : {}),
        })
        return { voted: true, action, charged: false }
      }

      // action === 'create': primeiro voto do usuário nesta publicação -- só aqui existe
      // cobrança, limite diário e ledger (seção 12). config continua fora da transação,
      // com o mesmo cache em memória por instância de sempre (5min TTL, ver
      // config-service.js) -- comportamento intocado.
      const config = await getEconomyConfig()
      const { costCoins, maxVotesPerUserDay } = config.voting
      const dateKey = todayKey(nowMs)
      const dailyRef = db.doc(`users/${uid}/economyDaily/${dateKey}`)
      const walletRef = wallet.walletRef(uid)
      const naturalKey = `vote:${statusId}:charge`
      const ledgerRef = ledger.ledgerRef(uid, naturalKey)

      // batch 3 (1 round trip, só neste branch): daily/wallet/ledger juntos -- aceito
      // ler wallet/ledger mesmo quando o limite diário abaixo acaba bloqueando a
      // votação (trade-off explícito: 1 round trip sempre, em vez de até 3
      // sequenciais).
      const [dailySnapshot, walletSnapshot, ledgerSnapshot] = await tx.getAll(
        dailyRef,
        walletRef,
        ledgerRef
      )

      const daily = dailySnapshot.exists ? dailySnapshot.data() : null
      const votesChargedToday = daily?.votesCharged || 0
      if (votesChargedToday >= maxVotesPerUserDay) {
        throw new HttpsError('resource-exhausted', 'Limite diário de votos atingido.')
      }

      const currentWallet = walletSnapshot.exists
        ? walletSnapshot.data()
        : { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }
      if (currentWallet.coinBalance < costCoins) {
        throw new HttpsError('failed-precondition', 'Saldo de EvoCoins insuficiente para votar.')
      }

      // Mesma trava dupla de idempotência de activity-service.js: charged=true (recém
      // decidido acima via decideVoteAction) já deveria bastar, o ledger é a rede de
      // segurança extra contra uma reexecução que visse o voto ainda não criado.
      const alreadyLedgered = ledgerSnapshot.exists
      // Todas as leituras da transação já aconteceram (acima) -- a partir daqui só
      // escritas, incluindo o contador de "Ver quem votou".
      applyVoteCountDelta()
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
