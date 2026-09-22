import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeScheduledWorkoutState,
  isScheduledWorkoutJoinable,
  nextWorkoutParticipationState,
} from './scheduledWorkout.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

test('describes a workout later today with its local time', () => {
  const now = new Date(2026, 8, 22, 8, 0).getTime()
  const event = new Date(2026, 8, 22, 17, 30).getTime()
  assert.deepEqual(describeScheduledWorkoutState(event, now), {
    key: 'today',
    label: 'Hoje · 17:30',
  })
})

test('uses a minute countdown near the start', () => {
  const now = new Date(2026, 8, 22, 17, 15).getTime()
  assert.deepEqual(describeScheduledWorkoutState(now + 15 * MINUTE, now), {
    key: 'soon',
    label: 'Começa em 15 min',
  })
})

test('uses an hour countdown before the event', () => {
  const now = new Date(2026, 8, 22, 15, 30).getTime()
  assert.deepEqual(describeScheduledWorkoutState(now + 2 * HOUR, now), {
    key: 'soon',
    label: 'Começa em 2h',
  })
})

test('marks the assumed two-hour window as ongoing and then concluded', () => {
  const start = new Date(2026, 8, 22, 17, 30).getTime()
  assert.equal(describeScheduledWorkoutState(start, start + HOUR).key, 'ongoing')
  assert.deepEqual(describeScheduledWorkoutState(start, start + 2 * HOUR), {
    key: 'concluded',
    label: 'Concluído',
  })
})

test('joinability depends only on workout.date, not on post expiration', () => {
  const now = Date.now()
  assert.equal(isScheduledWorkoutJoinable(now + MINUTE, now), true)
  assert.equal(isScheduledWorkoutJoinable(now, now), false)
  assert.equal(isScheduledWorkoutJoinable(now - MINUTE, now), false)
})

test('joining and cancelling update the current user state without a reload', () => {
  assert.deepEqual(nextWorkoutParticipationState(2, true), {
    count: 3,
    amParticipant: true,
  })
  assert.deepEqual(nextWorkoutParticipationState(3, false), {
    count: 2,
    amParticipant: false,
  })
  assert.equal(nextWorkoutParticipationState(0, false).count, 0)
})
