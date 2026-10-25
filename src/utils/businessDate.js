// ÚNICA fonte do "dia de negócio" do Evolutus: America/Sao_Paulo -- o mesmo fuso que o banco usa
// (private.sp_today()) para agrupar o dia de treino, o teto diário e a recompensa. O fuso configurado no
// APARELHO nunca decide o que é "hoje" para o produto: um celular em Tóquio, Nova York ou com o relógio
// fora do lugar continua vendo o dia do Brasil.
//
// Regras:
//  - o RELÓGIO só responde "que dia é hoje?" (businessDayKey); uma entidade que já tem data (workout.date)
//    mantém a PRÓPRIA data e nunca é recalculada pelo relógio atual (sincronizar no dia seguinte não muda o
//    dia do treino);
//  - o servidor segue sendo a autoridade (get_my_evocoin_day / complete_workout_session): este helper
//    serve para UX, validação local e para decidir quais mutações precisam estar sincronizadas;
//  - nada de timestamps do cliente para recompensa, autorização ou created_at (isso é do servidor).
//
// Chaves de dia são strings 'YYYY-MM-DD' (comparáveis lexicograficamente).
export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const SECOND = 1000
const DAY = 86_400_000

export function isBusinessDayKey(value) {
  return typeof value === 'string' && DAY_KEY.test(value)
}

// Dia de negócio de um instante (padrão: agora). `date` pode ser Date ou epoch em ms.
export function businessDayKey(date = new Date()) {
  const instant = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(instant.getTime())) throw new RangeError('businessDayKey: instante inválido')
  return formatter.format(instant)
}

// Soma/subtrai dias a uma CHAVE de dia (aritmética de calendário, sem fuso nem horário de verão).
export function addDaysToDayKey(dayKey, days) {
  if (!isBusinessDayKey(dayKey)) throw new RangeError('addDaysToDayKey: chave de dia inválida')
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

// "Faz N dias" no calendário do negócio (janelas de histórico, retenção do cache).
export function businessDayKeyDaysAgo(days, now = new Date()) {
  return addDaysToDayKey(businessDayKey(now), -days)
}

// Uma data de treino no futuro (em relação ao dia de negócio) é inválida.
export function isFutureBusinessDay(dayKey, now = new Date()) {
  return isBusinessDayKey(dayKey) && dayKey > businessDayKey(now)
}

// Dia (YYYY-MM-DD) de um valor de data de treino já normalizado pelo app ('2026-10-05T12:00:00') ou do
// banco ('2026-10-05'): é a PRÓPRIA data da entidade, sem passar por Date nem por fuso.
export function entityDayKey(value) {
  const text = typeof value === 'string' ? value.slice(0, 10) : ''
  return isBusinessDayKey(text) ? text : null
}

export function secondsOfDayIn(timeZone, now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type) => Number(parts.find((part) => part.type === type)?.value)
  return value('hour') * 3600 + value('minute') * 60 + value('second')
}

// Quanto falta (ms) para a próxima virada do dia de negócio (America/Sao_Paulo), a partir de `now`.
// Única fonte para agendar um único setTimeout até a próxima fronteira -- sem polling -- usada tanto
// pelas saudações (features/greetings/clock.js) quanto pela rotação diária de banners (features/home).
export function msUntilNextBusinessDay(now = new Date()) {
  return DAY - (secondsOfDayIn(BUSINESS_TIME_ZONE, now) * SECOND + now.getMilliseconds())
}
