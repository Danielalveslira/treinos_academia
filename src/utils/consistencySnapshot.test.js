import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildConsistencySnapshot } from './consistencySnapshot.js'
import { buildShareOptions } from './shareProgress.js'

const PLAN = {
  plannedTrainingDays: ['monday', 'wednesday', 'friday'],
  effectiveFrom: '2026-01-01',
  timezone: 'America/Sao_Paulo',
}
const day = (dateKey) => ({ dateKey, workoutCount: 1, exerciseStats: [] })

test('current streak crosses the year boundary (timeline starts Dec 1st of the previous year); annual figures stay in the year', () => {
  const now = new Date(2027, 0, 3, 12)
  const progress = ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'].map(day)
  const { activityDays, consistency } = buildConsistencySnapshot(progress, undefined, now)
  assert.equal(consistency.current, 5)
  assert.equal(activityDays[0].dateKey, '2027-01-01')
  assert.equal(consistency.totalWorkouts, 3)
})

test('the Home and the community share flow use the same snapshot: same streak in the daily card', () => {
  const now = new Date(2026, 9, 2, 18)
  const progress = ['2026-09-30', '2026-10-01', '2026-10-02'].map(day)
  const { consistency } = buildConsistencySnapshot(progress, PLAN, now)
  const options = buildShareOptions({ progressDays: progress, preferences: PLAN, consistency, now })
  const daily = options.find((o) => o.variant === 'daily')
  assert.equal(daily.metrics[0].value, String(consistency.current))
})

test('planned rest days keep the streak alive in the snapshot', () => {
  const now = new Date(2026, 9, 2, 18) // sexta
  const progress = ['2026-09-28', '2026-09-30', '2026-10-02'].map(day) // seg, qua, sex; ter/qui descanso
  const { consistency } = buildConsistencySnapshot(progress, PLAN, now)
  assert.equal(consistency.current >= 5, true)
})
