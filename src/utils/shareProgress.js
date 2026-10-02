import {
  buildActivityDays,
  buildCalendarWeeks,
  calculateConsistency,
  dateFromKey,
  localDayKey,
} from './activityCalendar.js'
import { buildWeeklyPlanDays, normalizeTrainingPreferences } from './trainingPlan.js'

// Cards de compartilhamento de progresso. TUDO aqui é local e puro: parte dos dados que a Home já carregou
// (progressDays = 1 RPC; preferências de treino do perfil) e reaproveita buildActivityDays/
// calculateConsistency/buildCalendarWeeks do calendário de consistência -- nenhuma consulta nova.
// O resultado é um "modelo" simples (título, grade de bloquinhos, métricas) que shareProgressSvg.js desenha.

export const SHARE_VARIANTS = ['daily', 'perfect_week', 'week', 'month', 'quarter']

export const VARIANT_LABELS = {
  daily: 'Dia',
  perfect_week: 'Semana perfeita',
  week: 'Semana',
  month: 'Mês',
  quarter: 'Trimestre',
}

const WEEKDAY_INITIALS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']
const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]
const MONTH_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function noon(date) {
  const copy = new Date(date)
  copy.setHours(12, 0, 0, 0)
  return copy
}

function addDays(date, amount) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + amount)
  return copy
}

// Semana de segunda a domingo (a mesma convenção do calendário/Dashboard).
export function getWeekRange(now = new Date()) {
  const start = noon(addDays(now, -((now.getDay() + 6) % 7)))
  return { start, end: addDays(start, 6) }
}

export function getMonthRange(now = new Date()) {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1, 12),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 12),
  }
}

export function getQuarterRange(now = new Date()) {
  const firstMonth = Math.floor(now.getMonth() / 3) * 3
  return {
    start: new Date(now.getFullYear(), firstMonth, 1, 12),
    end: new Date(now.getFullYear(), firstMonth + 3, 0, 12),
  }
}

// Dias do período com o estado visual de cada um. `planned` marca o que o PLANEJAMENTO previa (buildActivityDays
// troca planned -> completed e perderia essa informação, necessária para "semana perfeita"). Só usa dados em memória.
function buildPeriodDays(progressDays, preferences, { now, start, end }) {
  const plan = buildWeeklyPlanDays(preferences, { now, startDate: start, endDate: end })
  const plannedKeys = new Set(
    plan.filter((day) => day.state === 'planned').map((day) => day.dateKey)
  )
  const days = buildActivityDays(progressDays, {
    now,
    plannedDays: plan,
    startDate: start,
    endDate: end,
  })
  return days.map((day) => ({ ...day, planned: plannedKeys.has(day.dateKey) }))
}

function summarize(days, now) {
  const upToToday = days.filter((day) => !day.isFuture)
  const completed = upToToday.filter((day) => day.state === 'completed')
  const planned = days.filter((day) => day.planned)
  return {
    activeDays: completed.length,
    workouts: completed.reduce((sum, day) => sum + day.workoutCount, 0),
    plannedTotal: planned.length,
    plannedDone: planned.filter((day) => day.state === 'completed').length,
    longestRun: calculateConsistency(days, now).longest,
  }
}

function cell(day, extra = {}) {
  return {
    dateKey: day.dateKey,
    state: day.state,
    isToday: day.isToday,
    isFuture: day.isFuture,
    ...extra,
  }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function fileName(variant, now) {
  return `evolutus-${variant.replace('_', '-')}-${localDayKey(now)}.png`
}

function formatLongDate(date) {
  return `${WEEKDAY_NAMES[date.getDay()]}, ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]}`
}

function formatRange(start, end) {
  const sameMonth = start.getMonth() === end.getMonth()
  return sameMonth
    ? `${start.getDate()}–${end.getDate()} de ${MONTH_NAMES[end.getMonth()]}`
    : `${start.getDate()} ${MONTH_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]}`
}

// ---------------------------------------------------------------------------------------------------------
// Semana perfeita: 100% do PLANEJADO da semana concluído. Só vale se existe planejamento e ele já estava vigente
// em TODA a semana (effectiveFrom <= segunda) -- senão a semana "perfeita" seria sobre um plano parcial.
// Descanso planejado não conta como pendência; treino fora do plano não atrapalha nem substitui um planejado.
export function evaluatePerfectWeek(
  progressDays,
  preferences,
  now = new Date(),
  weekStart = getWeekRange(now).start
) {
  const plan = normalizeTrainingPreferences(preferences)
  const range = { start: weekStart, end: addDays(weekStart, 6) }
  if (plan.plannedTrainingDays.length === 0 || !plan.effectiveFrom) return null
  if (plan.effectiveFrom > localDayKey(range.start)) return null
  const days = buildPeriodDays(progressDays, preferences, { now, ...range })
  const planned = days.filter((day) => day.planned)
  if (planned.length === 0) return null
  if (!planned.every((day) => day.state === 'completed')) return null
  return {
    days,
    range,
    plannedCount: planned.length,
    workouts: days.reduce((sum, day) => sum + day.workoutCount, 0),
  }
}

// ---------------------------------------------------------------------------------------------------------
function dailyModel({ days, now, consistency }) {
  const today = days.find((day) => day.dateKey === localDayKey(now))
  if (!today || today.state !== 'completed') return null
  const exercises = new Set((today.exerciseStats || []).map((stat) => stat.exerciseId)).size
  const metrics = [
    {
      label: consistency.current === 1 ? 'dia seguido' : 'dias seguidos',
      value: String(consistency.current),
    },
    { label: today.workoutCount === 1 ? 'treino' : 'treinos', value: String(today.workoutCount) },
  ]
  if (exercises > 0)
    metrics.push({ label: exercises === 1 ? 'exercício' : 'exercícios', value: String(exercises) })
  return {
    variant: 'daily',
    eyebrow: 'Treino do dia',
    title: 'Treino concluído',
    period: { start: localDayKey(now), end: localDayKey(now) },
    subtitle: formatLongDate(now),
    grid: {
      kind: 'row',
      headers: null,
      rows: [
        days.map((day) =>
          cell(day, { label: WEEKDAY_INITIALS[(dateFromKey(day.dateKey).getDay() + 6) % 7] })
        ),
      ],
    },
    metrics,
    alt: `Treino do dia: treino concluído em ${formatLongDate(now)}`,
  }
}

function perfectWeekModel({ perfect, consistency }) {
  const metrics = [
    { label: 'planejados', value: `${perfect.plannedCount}/${perfect.plannedCount}` },
    { label: perfect.workouts === 1 ? 'treino' : 'treinos', value: String(perfect.workouts) },
    {
      label: consistency.current === 1 ? 'dia seguido' : 'dias seguidos',
      value: String(consistency.current),
    },
  ]
  return {
    variant: 'perfect_week',
    eyebrow: 'Semana perfeita',
    title: '100% do plano',
    period: { start: localDayKey(perfect.range.start), end: localDayKey(perfect.range.end) },
    subtitle: formatRange(perfect.range.start, perfect.range.end),
    grid: {
      kind: 'row',
      headers: null,
      rows: [perfect.days.map((day, index) => cell(day, { label: WEEKDAY_INITIALS[index] }))],
    },
    metrics,
    alt: `Semana perfeita: ${perfect.plannedCount} de ${perfect.plannedCount} treinos planejados concluídos`,
  }
}

function weekModel({ progressDays, preferences, consistency, now }) {
  const range = getWeekRange(now)
  const days = buildPeriodDays(progressDays, preferences, { now, ...range })
  const summary = summarize(days, now)
  const metrics = [
    {
      label:
        summary.plannedTotal > 0
          ? 'do plano'
          : summary.activeDays === 1
            ? 'dia treinado'
            : 'dias treinados',
      value:
        summary.plannedTotal > 0
          ? `${summary.plannedDone}/${summary.plannedTotal}`
          : String(summary.activeDays),
    },
    { label: summary.workouts === 1 ? 'treino' : 'treinos', value: String(summary.workouts) },
    {
      label: consistency.current === 1 ? 'dia seguido' : 'dias seguidos',
      value: String(consistency.current),
    },
  ]
  return {
    variant: 'week',
    eyebrow: 'Minha semana',
    title: formatRange(range.start, range.end),
    period: { start: localDayKey(range.start), end: localDayKey(range.end) },
    subtitle: null,
    grid: {
      kind: 'row',
      headers: null,
      rows: [days.map((day, index) => cell(day, { label: WEEKDAY_INITIALS[index] }))],
    },
    metrics,
    alt: `Minha semana: ${plural(summary.activeDays, 'dia treinado', 'dias treinados')}`,
  }
}

function monthModel({ progressDays, preferences, now }) {
  const range = getMonthRange(now)
  const days = buildPeriodDays(progressDays, preferences, { now, ...range })
  const summary = summarize(days, now)
  const weeks = buildCalendarWeeks(days)
  return {
    variant: 'month',
    eyebrow: 'Resumo mensal',
    period: { start: localDayKey(range.start), end: localDayKey(range.end) },
    title: `${MONTH_NAMES[now.getMonth()][0].toUpperCase()}${MONTH_NAMES[now.getMonth()].slice(1)}`,
    subtitle: String(now.getFullYear()),
    grid: {
      kind: 'calendar',
      headers: WEEKDAY_INITIALS,
      rows: weeks.map((week) =>
        week.map((day) =>
          day ? cell(day, { label: String(dateFromKey(day.dateKey).getDate()) }) : null
        )
      ),
    },
    metrics: [
      {
        label: summary.activeDays === 1 ? 'dia treinado' : 'dias treinados',
        value: String(summary.activeDays),
      },
      { label: summary.workouts === 1 ? 'treino' : 'treinos', value: String(summary.workouts) },
      { label: 'melhor sequência', value: String(summary.longestRun) },
    ],
    alt: `Resumo de ${MONTH_NAMES[now.getMonth()]}: ${plural(summary.activeDays, 'dia treinado', 'dias treinados')}`,
  }
}

function quarterModel({ progressDays, preferences, now }) {
  const range = getQuarterRange(now)
  const days = buildPeriodDays(progressDays, preferences, { now, ...range })
  const summary = summarize(days, now)
  const weeks = buildCalendarWeeks(days)
  // Heatmap: cada semana é uma coluna; rótulo do mês na primeira coluna em que ele começa.
  const monthLabels = weeks.map((week, index) => {
    const first = week.find(Boolean)
    const previous = weeks[index - 1]?.find(Boolean)
    if (!first) return ''
    const month = dateFromKey(first.dateKey).getMonth()
    return !previous || dateFromKey(previous.dateKey).getMonth() !== month ? MONTH_SHORT[month] : ''
  })
  const quarter = Math.floor(now.getMonth() / 3) + 1
  return {
    variant: 'quarter',
    eyebrow: 'Resumo trimestral',
    period: { start: localDayKey(range.start), end: localDayKey(range.end) },
    title: `${quarter}º trimestre`,
    subtitle: String(now.getFullYear()),
    grid: {
      kind: 'heatmap',
      headers: monthLabels,
      rows: weeks.map((week) => week.map((day) => (day ? cell(day) : null))),
    },
    metrics: [
      {
        label: summary.activeDays === 1 ? 'dia treinado' : 'dias treinados',
        value: String(summary.activeDays),
      },
      { label: summary.workouts === 1 ? 'treino' : 'treinos', value: String(summary.workouts) },
      { label: 'melhor sequência', value: String(summary.longestRun) },
    ],
    alt: `Resumo do ${quarter}º trimestre: ${plural(summary.activeDays, 'dia treinado', 'dias treinados')}`,
  }
}

export const CAPTION_MAX_LENGTH = 280

// Metadado que acompanha o card quando ele é PUBLICADO numa comunidade (a imagem em si vai pelo pipeline de fotos).
// kind = variante do card; período em dias locais (YYYY-MM-DD). Mensagem opcional, aparada e limitada ao tamanho da
// legenda das fotos.
export function buildProgressPayload(model, caption = '') {
  return {
    caption: String(caption ?? '')
      .trim()
      .slice(0, CAPTION_MAX_LENGTH),
    progress: { kind: model.variant, periodStart: model.period.start, periodEnd: model.period.end },
  }
}

// Todas as variantes DISPONÍVEIS agora, na ordem de SHARE_VARIANTS. "Dia" só existe se hoje foi concluído;
// "Semana perfeita" só existe quando a semana atual (ou, logo depois da virada, a anterior) tem 100% do
// planejado concluído. Semana/mês/trimestre estão sempre disponíveis.
export function buildShareOptions({
  progressDays = [],
  preferences,
  consistency,
  username = null,
  now = new Date(),
}) {
  const safeConsistency = consistency || { current: 0, longest: 0 }
  const options = []
  const todayDays = buildPeriodDays(progressDays, preferences, {
    now,
    start: noon(addDays(now, -6)),
    end: noon(now),
  })
  const daily = dailyModel({ days: todayDays, now, consistency: safeConsistency })
  if (daily) options.push(daily)

  const thisWeek = getWeekRange(now).start
  const perfect =
    evaluatePerfectWeek(progressDays, preferences, now, thisWeek) ||
    evaluatePerfectWeek(progressDays, preferences, now, addDays(thisWeek, -7))
  if (perfect) options.push(perfectWeekModel({ perfect, consistency: safeConsistency }))

  const common = { progressDays, preferences, consistency: safeConsistency, now }
  options.push(weekModel(common), monthModel(common), quarterModel(common))

  return options.map((model) => ({
    ...model,
    handle: username ? `@${username}` : null,
    filename: fileName(model.variant, now),
    shareText: 'Meu progresso no Evolutus',
  }))
}
