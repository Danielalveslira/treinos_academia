import { getWorkoutSets, isValidSet, MAX_WORKOUT_SETS } from './workoutSets.js'

export function suggestedSets(workout) {
  const sets = workout ? getWorkoutSets(workout).slice(0, MAX_WORKOUT_SETS) : []
  return sets.length
    ? sets.map((set) =>
        isValidSet(set)
          ? { weight: String(set.weight), reps: String(set.reps), source: 'history' }
          : { weight: '', reps: '', source: 'empty' }
      )
    : [{ weight: '', reps: '', source: 'empty' }]
}

export function inheritSet(target, previous, completed) {
  if (
    completed ||
    target.source === 'history' ||
    target.source === 'manual' ||
    !isValidSet(previous)
  )
    return target
  return { ...target, weight: previous.weight, reps: previous.reps, source: 'inherited' }
}

// Empty and trailing decimal drafts stay editable; invalid syntax/ranges never enter state.
export function parseSetInput(field, raw) {
  const value = raw.replace(',', '.')
  if (value === '') return ''
  const pattern = field === 'weight' ? /^\d+(\.\d*)?$/ : /^\d+$/
  if (!pattern.test(value) || !Number.isFinite(Number(value))) return null
  if (Number(value) > (field === 'weight' ? 10000 : 100000)) return null
  return value
}
