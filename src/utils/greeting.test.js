import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDashboardGreeting, hasWorkoutOn, IMPACT_EYEBROW } from './greeting.js'

test('hasWorkoutOn matches the local calendar day, ignoring time and accepting timestamp-shaped dates ({ toDate })', () => {
  const today = new Date(2026, 8, 10, 9, 0, 0)
  const sameDayNoon = new Date(2026, 8, 10, 12, 0, 0)
  const yesterday = new Date(2026, 8, 9, 12, 0, 0)
  assert.equal(hasWorkoutOn([{ date: sameDayNoon }], today), true)
  assert.equal(hasWorkoutOn([{ date: { toDate: () => sameDayNoon } }], today), true)
  assert.equal(hasWorkoutOn([{ date: yesterday }], today), false)
  assert.equal(hasWorkoutOn([], today), false)
})

test('priority: today\'s activity beats time of day — a trained user never sees "vamos treinar" copy', () => {
  const morning = new Date(2026, 8, 10, 8, 0, 0)
  const trainedToday = [{ date: new Date(2026, 8, 10, 7, 0, 0) }]
  const greeting = getDashboardGreeting({ firstName: 'Ana', workouts: trainedToday, now: morning })
  assert.equal(greeting.trainedToday, true)
  assert.equal(greeting.eyebrow, IMPACT_EYEBROW)
  assert.doesNotMatch(greeting.heading.toLowerCase(), /vamos treinar|pronto para/)
})

test('falls back to a pressure-free time-of-day greeting when nothing was trained today', () => {
  const workouts = [{ date: new Date(2026, 8, 9, 12, 0, 0) }] // yesterday
  const morning = getDashboardGreeting({
    firstName: 'Ana',
    workouts,
    now: new Date(2026, 8, 10, 8, 0),
  })
  assert.equal(morning.trainedToday, false)
  assert.equal(morning.eyebrow, IMPACT_EYEBROW)
  assert.match(morning.heading, /Bom dia/)

  const afternoon = getDashboardGreeting({
    firstName: 'Ana',
    workouts,
    now: new Date(2026, 8, 10, 14, 0),
  })
  assert.equal(afternoon.eyebrow, IMPACT_EYEBROW)
  assert.match(afternoon.heading, /Boa tarde/)

  const night = getDashboardGreeting({
    firstName: 'Ana',
    workouts,
    now: new Date(2026, 8, 10, 20, 0),
  })
  assert.equal(night.eyebrow, IMPACT_EYEBROW)
  assert.match(night.heading, /Boa noite/)

  const lateNight = getDashboardGreeting({
    firstName: 'Ana',
    workouts,
    now: new Date(2026, 8, 10, 2, 0),
  })
  assert.equal(lateNight.eyebrow, IMPACT_EYEBROW)
  assert.match(lateNight.heading, /Boa noite/)
  assert.doesNotMatch(
    [morning, afternoon, night, lateNight].map((item) => item.heading).join(' '),
    /ainda dá tempo|perder|vamos treinar/i
  )
})

test('prioritizes planned, in-progress, rest and return contexts without guilt', () => {
  const base = { firstName: 'Ana', now: new Date(2026, 8, 10, 14), uid: 'u1' }
  assert.match(
    getDashboardGreeting({ ...base, todayState: 'planned' }).heading,
    /treino|planejado/i
  )
  assert.match(
    getDashboardGreeting({ ...base, todayState: 'in_progress' }).heading,
    /andamento|continue/i
  )
  assert.match(getDashboardGreeting({ ...base, todayState: 'rest' }).heading, /recupera/i)
  assert.match(
    getDashboardGreeting({ ...base, todayState: 'none', daysSinceLastActivity: 4 }).heading,
    /volta|retome/i
  )
})

test('uses a distinct pressure-free message after the preferred reminder time', () => {
  const greeting = getDashboardGreeting({
    firstName: 'Ana',
    todayState: 'planned',
    reminderDue: true,
    now: new Date(2026, 8, 10, 19),
    uid: 'u1',
  })
  assert.match(greeting.heading, /planejado|horário preferido/i)
  assert.doesNotMatch(greeting.heading, /perder|atrasado|última chance/i)
})

test('missing name uses the supplied neutral fallback', () => {
  const greeting = getDashboardGreeting({
    firstName: 'atleta',
    todayState: 'none',
    now: new Date(2026, 8, 10, 8),
  })
  assert.match(greeting.heading, /atleta/)
})

test('the message is stable across repeated calls with the same context — refreshing the page never changes it', () => {
  const now = new Date(2026, 8, 10, 8, 0, 0)
  const workouts = [{ date: new Date(2026, 8, 10, 7, 0, 0) }]
  const first = getDashboardGreeting({ firstName: 'Ana', workouts, now, uid: 'user-1' })
  for (let i = 0; i < 5; i += 1) {
    const again = getDashboardGreeting({ firstName: 'Ana', workouts, now, uid: 'user-1' })
    assert.equal(again.heading, first.heading)
    assert.equal(again.eyebrow, first.eyebrow)
  }
})

test('the name is embedded in the heading when the picked variant uses it', () => {
  const now = new Date(2026, 8, 10, 8, 0, 0)
  const workouts = [{ date: new Date(2026, 8, 10, 7, 0, 0) }]
  // Sweeps a handful of uids so at least one lands on a variant that includes the name.
  const headings = Array.from(
    { length: 10 },
    (_, i) => getDashboardGreeting({ firstName: 'Marcela', workouts, now, uid: `u${i}` }).heading
  )
  assert.ok(headings.some((heading) => heading.includes('Marcela')))
})
