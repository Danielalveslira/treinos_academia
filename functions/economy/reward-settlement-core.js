// Lógica pura do settlement de recompensa (seções 15-19 do prompt de economia +
// auditoria de Fase 3). Nenhuma chamada ao Firestore aqui -- a orquestração
// (reward-settlement-service.js) lê tudo primeiro, monta os objetos simples que estas
// funções esperam, e só então aplica os deltas devolvidos.

// deletionJobExists: a conta do autor está em processo de exclusão.
// restriction: o documento de accountRestrictions/{authorId} do autor (ou null).
// nowMs: relógio do servidor no momento do settlement.
//
// 'permanently_ineligible' -- conta excluída ou system_ban: o voto nunca vai gerar
//   crédito, em nenhuma execução futura (ver nextRewardState: 'capped' é absorvente).
// 'temporarily_ineligible' -- suspensão temporária ainda ativa: o voto fica 'deferred'
//   (não 'capped'), com retryAt = fim da suspensão, pra ser reavaliado depois --
//   suspensão é reversível pelo tempo, ao contrário de exclusão/banimento permanente.
// 'eligible' -- segue para os 4 limites econômicos.
export function evaluateAuthorEligibility({ deletionJobExists, restriction, nowMs }) {
  if (deletionJobExists) {
    return { status: 'permanently_ineligible', reason: 'author_deleted' }
  }
  if (restriction) {
    if (restriction.action === 'system_ban') {
      return { status: 'permanently_ineligible', reason: 'author_banned' }
    }
    if (restriction.action === 'temporary_suspension') {
      const until = restriction.until?.toMillis ? restriction.until.toMillis() : restriction.until
      if (typeof until === 'number' && until > nowMs) {
        return { status: 'temporarily_ineligible', reason: 'author_suspended', retryAt: until }
      }
    }
  }
  // Restrição de COMUNIDADE nunca entra aqui de propósito -- é sobre participação numa
  // comunidade específica, não sobre o saldo global de EvoCoins do autor (decisão
  // deliberada, ver auditoria de Fase 3). accountStatus:'disabled' também fica de fora
  // pelo mesmo motivo: sem precedente equivalente do lado do votante, e exigiria uma
  // 3ª leitura por autor sem um ganho de segurança claro o bastante para justificá-la.
  return { status: 'eligible' }
}

function bump(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount)
}

// votes: array de candidatos NA ORDEM GLOBAL correta (rewardPendingAt asc, já garantida
// por quem monta esta lista) -- cada um:
//   { voteKey, authorId, voterId, statusId, rewardDayKey, statusEligible, authorEligibility }
// statusEligible: bool (a publicação ainda existe e authorId bate com o esperado).
// authorEligibility: resultado de evaluateAuthorEligibility() para este authorId.
//
// initialCounters: totais JÁ PERSISTIDOS antes deste lote --
//   postDaily:       { "statusId|day": coinsCredited }
//   authorDaily:      { "authorId|day": authorRewardCoins }
//   voterAuthorDaily: { "voterId|day|authorId": count }
//   voterDaily:       { "voterId|day": rewardedVotesGiven }
//
// limits: economyConfig.voting -- rewardCoinsPerPositiveVote, maxRewardCoinsPerPostDay,
//   maxRewardCoinsPerAuthorDay, maxRewardedVotesSameAuthorPerVoterDay,
//   maxRewardedVotesPerVoterDay.
//
// CRÍTICO: os votos são avaliados na ORDEM RECEBIDA, nunca reagrupados por autor antes
// de decidir -- maxRewardedVotesPerVoterDay atravessa autores diferentes, então
// reordenar por autor quebraria a regra "evento mais antigo consome o limite primeiro"
// (auditoria de Fase 3, ponto 1 da rodada anterior). Agrupar por autor só faz sentido
// DEPOIS de decidir, puramente para consolidar as ESCRITAS (authorCredits abaixo).
export function planSettlementBatch({ votes, initialCounters, limits }) {
  const postDaily = new Map(Object.entries(initialCounters.postDaily || {}))
  const authorDaily = new Map(Object.entries(initialCounters.authorDaily || {}))
  const voterAuthorDaily = new Map(Object.entries(initialCounters.voterAuthorDaily || {}))
  const voterDaily = new Map(Object.entries(initialCounters.voterDaily || {}))

  const outcomes = []
  const postDeltas = new Map()
  const authorDeltas = new Map()
  const voterAuthorDeltas = new Map()
  const voterDeltas = new Map()
  const authorCredits = new Map() // authorId -> { amount, voteKeys: [] }

  for (const vote of votes) {
    const { voteKey, authorId, voterId, statusId, rewardDayKey, statusEligible, authorEligibility } = vote

    if (!statusEligible) {
      outcomes.push({ voteKey, outcome: 'capped', reason: 'status_gone' })
      continue
    }
    if (authorEligibility.status === 'permanently_ineligible') {
      outcomes.push({ voteKey, outcome: 'capped', reason: authorEligibility.reason })
      continue
    }
    if (authorEligibility.status === 'temporarily_ineligible') {
      // deferred NÃO reserva quota: não toca em nenhum contador, mesmo sendo o evento
      // mais antigo da fila -- ver documentação da semântica no service.
      outcomes.push({
        voteKey,
        outcome: 'deferred',
        reason: authorEligibility.reason,
        retryAt: authorEligibility.retryAt,
      })
      continue
    }

    const postKey = `${statusId}|${rewardDayKey}`
    const authorKey = `${authorId}|${rewardDayKey}`
    const voterAuthorKey = `${voterId}|${rewardDayKey}|${authorId}`
    const voterKey = `${voterId}|${rewardDayKey}`

    const postTotal = postDaily.get(postKey) || 0
    const authorTotal = authorDaily.get(authorKey) || 0
    const voterAuthorCount = voterAuthorDaily.get(voterAuthorKey) || 0
    const voterCount = voterDaily.get(voterKey) || 0

    const amount = limits.rewardCoinsPerPositiveVote
    const fitsPost = postTotal + amount <= limits.maxRewardCoinsPerPostDay
    const fitsAuthor = authorTotal + amount <= limits.maxRewardCoinsPerAuthorDay
    const fitsVoterAuthor = voterAuthorCount + 1 <= limits.maxRewardedVotesSameAuthorPerVoterDay
    const fitsVoter = voterCount + 1 <= limits.maxRewardedVotesPerVoterDay

    if (!fitsPost || !fitsAuthor || !fitsVoterAuthor || !fitsVoter) {
      const reason = !fitsPost
        ? 'post_daily_limit'
        : !fitsAuthor
          ? 'author_daily_limit'
          : !fitsVoterAuthor
            ? 'voter_author_daily_limit'
            : 'voter_daily_limit'
      outcomes.push({ voteKey, outcome: 'capped', reason })
      continue
    }

    // Aceito -- atualiza os totais EM MEMÓRIA agora, pra que os PRÓXIMOS votos deste
    // mesmo lote (ainda na ordem global) já enxerguem o efeito deste antes de decidir.
    postDaily.set(postKey, postTotal + amount)
    authorDaily.set(authorKey, authorTotal + amount)
    voterAuthorDaily.set(voterAuthorKey, voterAuthorCount + 1)
    voterDaily.set(voterKey, voterCount + 1)

    bump(postDeltas, postKey, amount)
    bump(authorDeltas, authorKey, amount)
    bump(voterAuthorDeltas, voterAuthorKey, 1)
    bump(voterDeltas, voterKey, 1)

    if (!authorCredits.has(authorId)) authorCredits.set(authorId, { amount: 0, voteKeys: [] })
    const credit = authorCredits.get(authorId)
    credit.amount += amount
    credit.voteKeys.push(voteKey)

    outcomes.push({ voteKey, outcome: 'processed' })
  }

  return {
    outcomes,
    postDeltas: Object.fromEntries(postDeltas),
    authorDeltas: Object.fromEntries(authorDeltas),
    voterAuthorDeltas: Object.fromEntries(voterAuthorDeltas),
    voterDeltas: Object.fromEntries(voterDeltas),
    // voteKeys ordenados -- a chave natural do ledger (montada por quem chama) precisa
    // ser determinística independente da ordem de iteração do Map.
    authorCredits: Object.fromEntries(
      [...authorCredits].map(([id, c]) => [id, { amount: c.amount, voteKeys: [...c.voteKeys].sort() }])
    ),
  }
}

// Chave natural do ledger consolidado -- derivada dos votos EFETIVAMENTE creditados
// (nunca de um executionId/janela de tempo): duas execuções que, por acaso, creditassem
// o MESMO conjunto de votos produziriam a MESMA chave (o create() do ledger falha na
// segunda, sem duplicar); um reprocessamento parcial (subconjunto diferente) produz uma
// chave diferente, correta pro que foi de fato creditado desta vez.
export function rewardSettlementNaturalKey(voteKeys) {
  return `reward-settlement:${[...voteKeys].sort().join(',')}`
}
