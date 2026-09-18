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
