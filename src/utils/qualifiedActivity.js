// Apoio de useQualifiedActivity. O servidor é quem decide quanto cada ping vale
// (register_qualified_activity); aqui só se decide quando o app pode parar de pingar no dia.

// Dia no fuso do servidor (America/Sao_Paulo) -- o mesmo que o banco usa para agrupar o dia.
export function saoPauloDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

// A recompensa de atividade do dia está RESOLVIDA quando foi paga, já tinha sido paga ou o
// servidor a barrou de vez (teto diário de EvoCoins cheio / regra desligada). O app só deixa de
// pingar no dia quando ela está resolvida E o dia já virou "dia ativo" (criação de comunidade) --
// parar antes disso impediria o dia de qualificar. Resposta sem dayQualified (servidor antigo)
// nunca encerra o dia: no pior caso custa um ping barato a mais.
const RESOLVED_REASONS = new Set([
  'already_granted',
  'already_ledgered',
  'daily_cap_reached',
  'rule_disabled',
])

export function isDayActivityComplete(result) {
  const rewardDone = result?.granted === true || RESOLVED_REASONS.has(result?.reason)
  return rewardDone && result?.dayQualified === true
}
