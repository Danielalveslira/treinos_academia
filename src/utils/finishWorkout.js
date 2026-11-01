// "Finalizar treino" é um evento do SERVIDOR: ele decide se houve esforço suficiente e quanto pagar em
// EvoCoins pelo relógio dele (complete_workout_session). Por isso:
//  - sem conexão NUNCA vai para a fila offline e nunca simula recompensa local;
//  - antes de pedir a conclusão, as mutações que afetam ESTE treino (o do dia) são sincronizadas e
//    confirmadas, porque o servidor só enxerga o que já sincronizou (senão ele diria "esforço
//    insuficiente" sobre registros que ainda estão no aparelho). Só as DESTE treino: pendência ou
//    conflito antigo de outro dia não impede concluir o de hoje e segue visível no SyncStatus.
// Os registros de séries/exercícios nunca são perdidos em nenhum desses caminhos.

export const FINISH_OFFLINE_MESSAGE =
  'Conecte-se à internet para finalizar o treino. Seus registros continuam salvos neste aparelho.'
export const FINISH_PENDING_MESSAGE =
  'Ainda há registros deste treino aguardando sincronização. Tente finalizar em instantes.'
export const FINISH_ATTENTION_MESSAGE =
  'Há registros deste treino que precisam de atenção. Resolva em "Ver detalhes" antes de finalizar.'
export const FINISH_ERROR_MESSAGE = 'Não foi possível finalizar o treino agora. Tente novamente.'

// outcome: 'offline' | 'pending' | 'attention' | 'insufficient' | 'invalid' | 'done' | 'error'
// getDay() devolve o DIA do treino a concluir ('YYYY-MM-DD'): o do SERVIDOR (get_my_evocoin_day), a mesma
// definição que complete_workout_session usa para pagar -- nunca o relógio/fuso do aparelho. A seleção de
// "quais mutações precisam estar sincronizadas" usa exatamente esse dia.
// flushPending(day) devolve { pending, failed } do treino em questão.
export async function runFinishWorkout({
  isOnline,
  getDay,
  flushPending,
  completeSession,
  classifyError,
}) {
  if (!isOnline()) return { outcome: 'offline' }
  try {
    const day = await getDay()
    const { pending = 0, failed = 0 } = await flushPending(day)
    if (failed > 0) return { outcome: 'attention', failed }
    if (pending > 0) return { outcome: 'pending', remaining: pending }
    const result = await completeSession()
    if (
      ['not_enough_activity', 'insufficient_activity'].includes(result?.reason) ||
      result?.status === 'insufficient_activity'
    )
      return { outcome: 'insufficient' }
    if (result?.status && !['completed', 'already_completed'].includes(result.status))
      return { outcome: 'invalid' }
    if (!result || (!result.status && typeof result.awardedCoins !== 'number'))
      return { outcome: 'error' }
    return { outcome: 'done' }
  } catch (error) {
    return { outcome: classifyError(error) === 'connectivity' ? 'offline' : 'error', error }
  }
}

export const FINISH_MESSAGES = {
  offline: FINISH_OFFLINE_MESSAGE,
  pending: FINISH_PENDING_MESSAGE,
  attention: FINISH_ATTENTION_MESSAGE,
  error: FINISH_ERROR_MESSAGE,
  insufficient:
    'Para concluir hoje, registre três exercícios ou pelo menos 15 minutos de cardio. Registros ainda não sincronizados não contam.',
  invalid: 'Esta ficha não está disponível para finalizar. Revise suas fichas.',
}
