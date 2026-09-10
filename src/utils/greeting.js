// A saudação do Dashboard prioriza, nessa ordem: 1) se o usuário já treinou hoje
// (reconhecimento, sem "vamos treinar"), 2) o período do dia (se ainda não treinou),
// 3) uma variação estável de frase dentro desse contexto — nunca aleatória a cada
// render, senão a mensagem trocaria sozinha a cada F5 sem nenhum motivo real.

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value)
}

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

const TRAINED_EYEBROW = 'TREINO CONCLUÍDO'
const TRAINED_MESSAGES = [
  (name) => `Treino de hoje concluído, ${name}. Boa.`,
  (name) => `Mandou bem hoje, ${name}.`,
  (name) => `Mais um treino concluído. Bom trabalho, ${name}.`,
  (name) => `Você já fez sua parte hoje, ${name}.`,
  () => 'Treino concluído por hoje. Continue assim.',
  (name) => `Boa, ${name}. Treino registrado hoje.`,
]

const PERIODS = {
  morning: {
    eyebrow: 'BOM DIA',
    messages: [
      (name) => `Bom dia, ${name}. Pronto para treinar?`,
      (name) => `Começando o dia treinando, ${name}?`,
    ],
  },
  afternoon: {
    eyebrow: 'BOA TARDE',
    messages: [
      (name) => `Boa tarde, ${name}. Pronto para evoluir?`,
      (name) => `Vamos treinar, ${name}?`,
    ],
  },
  night: {
    eyebrow: 'BOA NOITE',
    messages: [
      (name) => `Boa noite, ${name}. Ainda dá tempo de treinar.`,
      (name) => `Fechar o dia com um treino, ${name}?`,
    ],
  },
}

// now: injetável para teste; em produção é sempre a hora local de verdade (new Date()).
export function getDashboardGreeting({ firstName, workouts, now = new Date(), uid = '' }) {
  const trainedToday = hasWorkoutOn(workouts, now)
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`

  if (trainedToday) {
    const index = stableIndex(`${uid}:${dayKey}:trained`, TRAINED_MESSAGES.length)
    return { eyebrow: TRAINED_EYEBROW, heading: TRAINED_MESSAGES[index](firstName), trainedToday }
  }

  const period = PERIODS[periodOfDay(now.getHours())]
  const index = stableIndex(`${uid}:${dayKey}:${periodOfDay(now.getHours())}`, period.messages.length)
  return { eyebrow: period.eyebrow, heading: period.messages[index](firstName), trainedToday }
}
