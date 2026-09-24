import { validId } from '../legal-core.js'

// Voto econômico (positivo/negativo, com custo em EvoCoins) -- seções 12-14 do prompt
// de economia. Modelagem e nomenclatura deliberadamente distintas do voto de ENQUETE
// já existente (statuses/{id}/votes/{uid}, gratuito, sem relação com a carteira):
// este vive em statuses/{id}/economyVotes/{uid}, para nunca ser confundido com aquele
// nem em código nem em auditoria de dados.
export function validateVoteOnPost(data) {
  if (!validId(data?.statusId)) return 'Publicação inválida.'
  if (data?.value !== 1 && data?.value !== -1 && data?.value !== null) {
    return 'Valor de voto inválido.'
  }
  return null
}

// Fonte única de elegibilidade por tipo, usada tanto pelas duas callables de voto
// (via vote-service) quanto pelo settlement de recompensas antigas. Poll possui voto
// próprio e workout possui RSVP; nenhum dos dois participa da economia.
export function economyVoteIneligibility(statusType) {
  if (statusType === 'poll') {
    return 'Enquetes não recebem voto econômico -- vote em uma das opções da enquete.'
  }
  if (statusType === 'workout') {
    return 'Treinos marcados não recebem voto econômico -- use a confirmação de participação.'
  }
  return null
}

export function isEconomyVoteEligibleStatusType(statusType) {
  return economyVoteIneligibility(statusType) == null
}

export function effectivePublicationExpiryMs(status) {
  const expiresAtMs = status?.expiresAtMs
  const promotedUntilMs = status?.promotedUntilMs
  const activePromotionExpiryMs =
    status?.promoted === true &&
    typeof promotedUntilMs === 'number' &&
    Number.isFinite(promotedUntilMs)
      ? promotedUntilMs
      : 0
  return Math.max(
    typeof expiresAtMs === 'number' && Number.isFinite(expiresAtMs) ? expiresAtMs : 0,
    activePromotionExpiryMs
  )
}

export function isPublicationInteractionActive(status, nowMs) {
  return effectivePublicationExpiryMs(status) > nowMs
}

// existingVote: documento atual em economyVotes/{uid} (ou null/undefined se o usuário
// nunca votou nesta publicação). incomingValue: 1 (positivo), -1 (negativo) ou null
// (remover o voto).
//
// 'create'  -- primeiro voto nesta publicação: cobra costCoins (seção 12).
// 'switch'  -- já tinha um voto ativo (charged=true) e está trocando de direção: sem
//              nova cobrança, o pagamento já foi feito uma vez para esta publicação.
// 'remove'  -- está retirando o voto ativo: sem reembolso, mas também sem impedir votar
//              de novo depois (charged nunca volta a false).
// 'noop'    -- pedido não muda nada (ex.: clicar de novo no mesmo valor, ou tentar
//              remover um voto que não existe) -- idempotente, nenhuma escrita.
export function decideVoteAction({ existingVote, incomingValue }) {
  const currentValue = existingVote ? existingVote.value : null
  if (currentValue === incomingValue) return { action: 'noop' }
  if (!existingVote) return { action: 'create' }
  if (incomingValue == null) return { action: 'remove' }
  return { action: 'switch' }
}

// Seção 15: só um voto POSITIVO pode virar recompensa para o autor, e só depois do
// processamento assíncrono da Fase 3 (reward-settlement-service.js). Um voto negativo,
// ou a ausência de voto (removido), nunca rende nada ao autor -- 'ineligible' de
// propósito, um estado TRANSITÓRIO (troca livremente com 'pending' conforme o valor).
//
// Cinco estados possíveis: 'pending', 'ineligible' (transitórios, recomputados a cada
// troca/remoção/revoto), 'deferred' (autor temporariamente suspenso -- também
// transitório: some se o votante mudar de ideia, some quando promovido de volta a
// pending pelo settlement), 'processed' e 'capped' (AMBOS terminais/absorventes).
//
// 'processed' = o settlement já creditou o autor por este voto. 'capped' = o settlement
// avaliou este voto e decidiu que ele NUNCA vai gerar crédito (limite econômico
// estourado, publicação removida, ou autor banido/excluído). Em ambos os casos, nenhuma
// troca de direção, remoção ou revoto posterior pode reverter a decisão -- sem isso,
// trocar pra negativo e voltar pra positivo recomputaria 'pending' num voto cujo
// resultado (crédito ou rejeição definitiva) já foi decidido, arriscando um
// reprocessamento futuro creditar o autor duas vezes pela mesma publicação/votante.
export function nextRewardState(existingRewardState, incomingValue) {
  if (existingRewardState === 'processed' || existingRewardState === 'capped') {
    return existingRewardState
  }
  return incomingValue === 1 ? 'pending' : 'ineligible'
}

// "Ver quem votou" -- delta de positiveVoteCount/negativeVoteCount (denormalizados em
// statuses/{id}, mantidos por um gatilho -- ver vote-count-service.js) a partir da
// transição ANTES -> DEPOIS de valor de UM documento em economyVotes. Pura, sem I/O,
// testável sem simular um CloudEvent do Firestore. Cobre as 3 transições possíveis de
// voteOnPost (create/switch/remove) mais a ausência total (before/after null,
// documento nunca existiu ou noop nunca chegou a escrever) -- create é
// null->1/null->-1, switch é 1->-1/-1->1, remove é 1->null/-1->null.
export function economyVoteCountDelta(beforeValue, afterValue) {
  const before = beforeValue ?? null
  const after = afterValue ?? null
  let positiveDelta = 0
  let negativeDelta = 0
  if (before === after) return { positiveDelta, negativeDelta }
  if (before === 1) positiveDelta -= 1
  else if (before === -1) negativeDelta -= 1
  if (after === 1) positiveDelta += 1
  else if (after === -1) negativeDelta += 1
  return { positiveDelta, negativeDelta }
}
