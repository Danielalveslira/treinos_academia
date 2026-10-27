// Novos lembretes abrem /treinar?planejado=AAAA-MM-DD; /novo-treino segue compatível.
// A data só vira rótulo de hoje no dia de negócio (America/Sao_Paulo): um toque tardio num aviso antigo cai no fluxo normal de treino, sem
// anunciar um "treino planejado" que já passou.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function plannedWorkoutNotice(param, todayKey) {
  if (!DATE_PATTERN.test(param || '') || param !== todayKey) return null
  return 'Treino planejado para hoje'
}
