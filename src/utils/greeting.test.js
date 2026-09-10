import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDashboardGreeting, hasWorkoutOn } from './greeting.js'

test('hasWorkoutOn matches the local calendar day, ignoring time and accepting Firestore timestamps', () => {
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
  assert.equal(greeting.eyebrow, 'TREINO CONCLUÍDO')
  assert.doesNotMatch(greeting.heading.toLowerCase(), /vamos treinar|pronto para/)
})

test('falls back to time-of-day greeting when nothing was trained today', () => {
  const workouts = [{ date: new Date(2026, 8, 9, 12, 0, 0) }] // yesterday
  const morning = getDashboardGreeting({ firstName: 'Ana', workouts, now: new Date(2026, 8, 10, 8, 0) })
  assert.equal(morning.trainedToday, false)
  assert.equal(morning.eyebrow, 'BOM DIA')

  const afternoon = getDashboardGreeting({ firstName: 'Ana', workouts, now: new Date(2026, 8, 10, 14, 0) })
  assert.equal(afternoon.eyebrow, 'BOA TARDE')

  const night = getDashboardGreeting({ firstName: 'Ana', workouts, now: new Date(2026, 8, 10, 20, 0) })
  assert.equal(night.eyebrow, 'BOA NOITE')

  const lateNight = getDashboardGreeting({ firstName: 'Ana', workouts, now: new Date(2026, 8, 10, 2, 0) })
  assert.equal(lateNight.eyebrow, 'BOA NOITE')
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
  const headings = Array.from({ length: 10 }, (_, i) =>
    getDashboardGreeting({ firstName: 'Marcela', workouts, now, uid: `u${i}` }).heading
  )
  assert.ok(headings.some((heading) => heading.includes('Marcela')))
})
