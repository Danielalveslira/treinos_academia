import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SHARE_VARIANTS,
  buildShareOptions,
  evaluatePerfectWeek,
  getMonthRange,
  getQuarterRange,
  getWeekRange,
} from './shareProgress.js'
import { localDayKey } from './activityCalendar.js'

// Datas fixas: sexta 2/out/2026 (semana 28/set–4/out).
const FRIDAY = new Date(2026, 9, 2, 18, 0)
const PLAN = {
  plannedTrainingDays: ['monday', 'wednesday', 'friday'],
  effectiveFrom: '2026-06-01',
  timezone: 'America/Sao_Paulo',
}
const day = (dateKey, workoutCount = 1, exercises = 2) => ({
  dateKey,
  workoutCount,
  exerciseStats: Array.from({ length: exercises }, (_, i) => ({ exerciseId: `e${i}` })),
})
const consistency = { current: 5, longest: 9 }
const optionFor = (options, variant) => options.find((option) => option.variant === variant)

test('week ranges run Monday to Sunday, also when "today" is a Sunday', () => {
  assert.equal(localDayKey(getWeekRange(FRIDAY).start), '2026-09-28')
  assert.equal(localDayKey(getWeekRange(FRIDAY).end), '2026-10-04')
  const sunday = new Date(2026, 9, 4, 20)
  assert.equal(localDayKey(getWeekRange(sunday).start), '2026-09-28')
  const monday = new Date(2026, 9, 5, 8)
  assert.equal(localDayKey(getWeekRange(monday).start), '2026-10-05')
})

test('month and quarter ranges (leap February, quarter edges)', () => {
  assert.equal(localDayKey(getMonthRange(new Date(2028, 1, 10)).end), '2028-02-29')
  assert.equal(localDayKey(getMonthRange(new Date(2026, 9, 2)).start), '2026-10-01')
  assert.deepEqual(
    [
      localDayKey(getQuarterRange(new Date(2026, 4, 20)).start),
      localDayKey(getQuarterRange(new Date(2026, 4, 20)).end),
    ],
    ['2026-04-01', '2026-06-30']
  )
  assert.equal(localDayKey(getQuarterRange(new Date(2026, 11, 31)).start), '2026-10-01')
})

test('perfect week needs 100% of the PLANNED days done (rest days are not required)', () => {
  const done = [day('2026-09-28'), day('2026-09-30'), day('2026-10-02')]
  const perfect = evaluatePerfectWeek(done, PLAN, FRIDAY)
  assert.equal(perfect.plannedCount, 3)
  assert.equal(perfect.days.length, 7)
  assert.equal(evaluatePerfectWeek(done.slice(0, 2), PLAN, FRIDAY), null)
})

test('perfect week: extra workouts on rest days neither break nor replace a planned day', () => {
  const extras = [day('2026-09-28'), day('2026-09-29'), day('2026-09-30'), day('2026-10-02')]
  assert.ok(evaluatePerfectWeek(extras, PLAN, FRIDAY))
  const replaced = [day('2026-09-28'), day('2026-09-29'), day('2026-09-30'), day('2026-10-03')]
  assert.equal(evaluatePerfectWeek(replaced, PLAN, FRIDAY), null)
})

test('perfect week: a planned day still ahead (not done yet) makes it NOT perfect', () => {
  const plan = { ...PLAN, plannedTrainingDays: ['monday', 'friday', 'sunday'] }
  const done = [day('2026-09-28'), day('2026-10-02')]
  assert.equal(evaluatePerfectWeek(done, plan, FRIDAY), null)
  assert.ok(evaluatePerfectWeek([...done, day('2026-10-04')], plan, new Date(2026, 9, 4, 20)))
})

test('perfect week never exists without a plan, or when the plan started mid-week', () => {
  const done = [day('2026-09-28'), day('2026-09-30'), day('2026-10-02')]
  assert.equal(
    evaluatePerfectWeek(done, { plannedTrainingDays: [], effectiveFrom: null }, FRIDAY),
    null
  )
  assert.equal(evaluatePerfectWeek(done, { ...PLAN, plannedTrainingDays: [] }, FRIDAY), null)
  assert.equal(evaluatePerfectWeek(done, { ...PLAN, effectiveFrom: '2026-09-30' }, FRIDAY), null)
  assert.equal(evaluatePerfectWeek(done, undefined, FRIDAY), null)
})

test('options: week, month and quarter are always available; daily and perfect_week only when earned', () => {
  const empty = buildShareOptions({ progressDays: [], preferences: PLAN, consistency, now: FRIDAY })
  assert.deepEqual(
    empty.map((o) => o.variant),
    ['week', 'month', 'quarter']
  )

  const trainedToday = buildShareOptions({
    progressDays: [day('2026-10-02', 2, 3)],
    preferences: PLAN,
    consistency,
    now: FRIDAY,
  })
  assert.deepEqual(
    trainedToday.map((o) => o.variant),
    ['daily', 'week', 'month', 'quarter']
  )

  const perfect = buildShareOptions({
    progressDays: [day('2026-09-28'), day('2026-09-30'), day('2026-10-02')],
    preferences: PLAN,
    consistency,
    now: FRIDAY,
  })
  assert.deepEqual(
    perfect.map((o) => o.variant),
    ['daily', 'perfect_week', 'week', 'month', 'quarter']
  )
  assert.ok(perfect.every((o) => SHARE_VARIANTS.includes(o.variant)))
})

test("right after the week turns over, last week's perfect week is still offered", () => {
  const lastWeek = [day('2026-09-28'), day('2026-09-30'), day('2026-10-02')]
  const monday = new Date(2026, 9, 5, 9, 0)
  const options = buildShareOptions({
    progressDays: lastWeek,
    preferences: PLAN,
    consistency,
    now: monday,
  })
  const perfect = optionFor(options, 'perfect_week')
  assert.ok(perfect)
  assert.equal(perfect.subtitle, '28 set – 4 out')
  assert.equal(optionFor(options, 'daily'), undefined)
})

test('daily card: only shows when today is completed and carries streak, workouts and exercises', () => {
  const options = buildShareOptions({
    progressDays: [day('2026-10-02', 2, 3)],
    preferences: PLAN,
    consistency: { current: 12, longest: 20 },
    now: FRIDAY,
  })
  const daily = optionFor(options, 'daily')
  assert.equal(daily.eyebrow, 'Conquista do dia')
  assert.deepEqual(
    daily.metrics.map((m) => `${m.value} ${m.label}`),
    ['12 dias seguidos', '2 treinos', '3 exercícios']
  )
  assert.equal(daily.grid.rows[0].length, 7)
  assert.equal(daily.grid.rows[0].at(-1).isToday, true)
  assert.equal(daily.grid.rows[0].at(-1).state, 'completed')
  const yesterdayOnly = buildShareOptions({
    progressDays: [day('2026-10-01')],
    preferences: PLAN,
    consistency,
    now: FRIDAY,
  })
  assert.equal(optionFor(yesterdayOnly, 'daily'), undefined)
})

test('week card respects planned rest and completed days', () => {
  const options = buildShareOptions({
    progressDays: [day('2026-09-28', 2), day('2026-09-30')],
    preferences: PLAN,
    consistency,
    username: 'ana',
    now: FRIDAY,
  })
  const week = optionFor(options, 'week')
  const states = week.grid.rows[0].map((c) => c.state)
  // seg ✓, ter descanso, qua ✓, qui descanso, sex planejado (hoje, ainda não treinou), sáb/dom descanso
  assert.deepEqual(states, ['completed', 'rest', 'completed', 'rest', 'planned', 'rest', 'rest'])
  assert.equal(week.grid.rows[0][4].isToday, true)
  assert.deepEqual(
    week.metrics.map((m) => `${m.value} ${m.label}`),
    ['2/3 do plano', '3 treinos', '5 dias seguidos']
  )
  assert.equal(week.handle, '@ana')
  assert.equal(week.filename, 'evolutus-week-2026-10-02.png')
})

test('week card without a plan counts trained days instead of plan progress', () => {
  const options = buildShareOptions({
    progressDays: [day('2026-09-29'), day('2026-09-30')],
    preferences: undefined,
    consistency,
    now: FRIDAY,
  })
  const week = optionFor(options, 'week')
  assert.equal(week.metrics[0].label, 'dias treinados')
  assert.equal(week.metrics[0].value, '2')
  assert.ok(week.grid.rows[0].every((c) => c.state === 'completed' || c.state === 'none'))
})

test('month card: calendar rows start on Monday, metrics come from the month only', () => {
  const progress = [day('2026-09-30'), day('2026-10-01'), day('2026-10-02', 2)]
  const options = buildShareOptions({
    progressDays: progress,
    preferences: PLAN,
    consistency,
    now: FRIDAY,
  })
  const month = optionFor(options, 'month')
  assert.equal(month.title, 'Outubro')
  assert.equal(month.grid.kind, 'calendar')
  assert.equal(month.grid.headers.length, 7)
  const cells = month.grid.rows.flat().filter(Boolean)
  assert.equal(cells.length, 31)
  assert.equal(cells[0].dateKey, '2026-10-01')
  assert.deepEqual(
    month.metrics.map((m) => `${m.value} ${m.label}`),
    ['2 dias treinados', '3 treinos', month.metrics[2].value + ' melhor sequência']
  )
})

test('quarter card: heatmap columns are weeks, 7 rows each, only days of the quarter', () => {
  const options = buildShareOptions({
    progressDays: [day('2026-07-01'), day('2026-09-30'), day('2026-10-02')],
    preferences: PLAN,
    consistency,
    now: new Date(2026, 8, 30, 12),
  })
  const quarter = optionFor(options, 'quarter')
  assert.equal(quarter.title, '3º trimestre')
  assert.equal(quarter.grid.kind, 'heatmap')
  assert.ok(quarter.grid.rows.every((week) => week.length === 7))
  const cells = quarter.grid.rows.flat().filter(Boolean)
  assert.equal(cells.length, 92)
  assert.equal(quarter.grid.headers.filter(Boolean).join(','), 'jul,ago,set')
  // 2/out está fora do trimestre
  assert.equal(
    cells.some((c) => c.dateKey === '2026-10-02'),
    false
  )
  assert.equal(quarter.metrics[0].value, '2')
})

test('malformed progress rows (null, missing dateKey, zero workouts, string counts) never crash', () => {
  const messy = [
    null,
    undefined,
    {},
    { dateKey: '2026-10-01', workoutCount: 0 },
    { dateKey: '2026-10-02', workoutCount: '2' },
  ]
  const options = buildShareOptions({
    progressDays: messy.filter(Boolean),
    preferences: PLAN,
    consistency: undefined,
    now: FRIDAY,
  })
  assert.ok(options.length >= 3)
  assert.equal(optionFor(options, 'daily').metrics[1].value, '2')
})
