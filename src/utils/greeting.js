import { toDate } from './date.js'

// A saudação do Dashboard prioriza, nessa ordem: 1) se o usuário já treinou hoje
// (reconhecimento, sem "vamos treinar"), 2) o período do dia (se ainda não treinou),
// 3) uma variação estável de frase dentro desse contexto — nunca aleatória a cada
// render, senão a mensagem trocaria sozinha a cada F5 sem nenhum motivo real.

function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// "date" nos treinos guarda só o dia escolhido pelo usuário (sempre meio-dia local, ver
// toTimestamp em workoutsService.js) — comparar o dia civil local é exatamente o que
// "já treinou hoje" significa, não a hora em que o registro foi salvo.
export function hasWorkoutOn(workouts, date) {
  return workouts.some((workout) => isSameLocalDay(toDate(workout.date), date))
}

function periodOfDay(hours) {
  if (hours < 5) return 'night'
  if (hours < 12) return 'morning'
  if (hours < 18) return 'afternoon'
  return 'night'
}

// Índice determinístico (não aleatório) a partir de uma chave textual — a mesma chave
// sempre escolhe a mesma frase, então atualizar a página no mesmo dia/contexto nunca
// troca a mensagem, só o dia (ou sair do "já treinou hoje") muda.
function stableIndex(key, length) {
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  }
  return hash % length
}

// Frase de impacto fixa: substitui as antigas variações de eyebrow por período do dia
// ("BOM DIA"/"BOA TARDE"/"BOA NOITE") e pós-treino ("TREINO CONCLUÍDO"), que repetiam a
// mesma saudação do heading logo acima dela (ex.: "BOM DIA" + "Bom dia, fulano...").
// Sempre a mesma, em qualquer estado — não é mais parte da variação por período/trained.
export const IMPACT_EYEBROW = 'SEU RITMO, SUA EVOLUÇÃO'

const TRAINED_MESSAGES = [
  (name) => `Treino de hoje concluído, ${name}. Boa.`,
  (name) => `Mandou bem hoje, ${name}.`,
  (name) => `Mais um treino concluído. Bom trabalho, ${name}.`,
  (name) => `Você já fez sua parte hoje, ${name}.`,
  () => 'Treino concluído por hoje. Continue assim.',
  (name) => `Boa, ${name}. Treino registrado hoje.`,
]

const PERIOD_MESSAGES = {
  morning: [
    (name) => `Bom dia, ${name}. Como você está hoje?`,
    (name) => `Bom dia, ${name}. Seu espaço está pronto.`,
  ],
  afternoon: [
    (name) => `Boa tarde, ${name}. Continue no seu ritmo.`,
    (name) => `Boa tarde, ${name}. Que bom ter você aqui.`,
  ],
  night: [
    (name) => `Boa noite, ${name}. Como foi seu dia?`,
    (name) => `Boa noite, ${name}. Seu progresso continua aqui.`,
  ],
}

const CONTEXT_MESSAGES = {
  in_progress: [
    (name) => `Seu treino está em andamento, ${name}.`,
    () => 'Continue de onde parou.',
  ],
  planned: [
    (name) => `Seu treino de hoje está pronto, ${name}.`,
    () => 'Há um treino planejado para hoje.',
  ],
  planned_due: [
    (name) => `Seu treino planejado está pronto, ${name}.`,
    () => 'Este é seu horário preferido. Comece quando estiver pronto.',
  ],
  rest: [
    (name) => `Hoje é dia de recuperação, ${name}.`,
    () => 'Recuperar também faz parte do processo.',
  ],
  return: [(name) => `Bom ter você de volta, ${name}.`, () => 'Retome no seu ritmo.'],
}

// now: injetável para teste; em produção é sempre a hora local de verdade (new Date()).
export function getDashboardGreeting({
  firstName,
  workouts = [],
  todayState,
  reminderDue = false,
  daysSinceLastActivity = null,
  now = new Date(),
  uid = '',
}) {
  const trainedToday = todayState === 'completed' || (!todayState && hasWorkoutOn(workouts, now))
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`

  if (trainedToday) {
    const index = stableIndex(`${uid}:${dayKey}:trained`, TRAINED_MESSAGES.length)
    return { eyebrow: IMPACT_EYEBROW, heading: TRAINED_MESSAGES[index](firstName), trainedToday }
  }

  const context =
    todayState === 'planned' && reminderDue
      ? 'planned_due'
      : todayState === 'in_progress' || todayState === 'planned' || todayState === 'rest'
        ? todayState
        : daysSinceLastActivity != null && daysSinceLastActivity >= 3
          ? 'return'
          : null
  if (context) {
    const messages = CONTEXT_MESSAGES[context]
    const index = stableIndex(`${uid}:${dayKey}:${context}`, messages.length)
    return { eyebrow: IMPACT_EYEBROW, heading: messages[index](firstName), trainedToday: false }
  }

  const messages = PERIOD_MESSAGES[periodOfDay(now.getHours())]
  const index = stableIndex(`${uid}:${dayKey}:${periodOfDay(now.getHours())}`, messages.length)
  return { eyebrow: IMPACT_EYEBROW, heading: messages[index](firstName), trainedToday }
}
