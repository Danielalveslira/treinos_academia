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

// O app só deixa de pingar no dia quando a recompensa diária já saiu E o dia já virou "dia
// ativo". A recompensa pode sair antes do mínimo de atividade do dia ativo (config), e parar
// antes disso impediria o dia de qualificar. Resposta sem dayQualified (servidor antigo)
// nunca encerra o dia: no pior caso custa um ping barato a mais.
export function isDayActivityComplete(result) {
  const rewardDone =
    result?.granted === true ||
    result?.reason === 'already_granted' ||
    result?.reason === 'already_ledgered'
  return rewardDone && result?.dayQualified === true
}
