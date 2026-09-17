import { summarizeDailyWorkouts, workoutDateKey } from '../functions/progress-daily-core.js'

const UID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/

export function parseBackfillArgs(args) {
  let uid = ''
  let apply = false
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--user' && !uid) {
      uid = args[index + 1] || ''
      index += 1
    } else if (args[index] === '--apply' && !apply) {
      apply = true
    } else {
      throw new Error('Use: node scripts/backfill-progress-daily.mjs --user <uid> [--apply]')
    }
  }
  if (!UID_PATTERN.test(uid)) {
    throw new Error('Use: node scripts/backfill-progress-daily.mjs --user <uid> [--apply]')
  }
  return { uid, apply }
}

export function buildBackfillPlan(workouts) {
  const workoutsByDay = new Map()
  for (const workout of workouts) {
    const day = workoutDateKey(workout)
    if (!day) continue
    const entries = workoutsByDay.get(day) || []
    entries.push(workout)
    workoutsByDay.set(day, entries)
  }
  return [...workoutsByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, entries]) => ({ dateKey, ...summarizeDailyWorkouts(entries) }))
}

export async function runProgressDailyBackfill({
  uid,
  apply,
  loadUser,
  loadWorkouts,
  loadExistingDayIds,
  applyPlan,
  log = () => {},
}) {
  const userExists = await loadUser(uid)
  if (!userExists) throw new Error(`Usuário não encontrado: ${uid}`)
  const workouts = await loadWorkouts(uid)
  const plan = buildBackfillPlan(workouts)
  const plannedIds = new Set(plan.map((day) => day.dateKey))
  const staleDayIds = (await loadExistingDayIds(uid)).filter((day) => !plannedIds.has(day))
  const base = {
    mode: apply ? 'APPLY' : 'DRY-RUN',
    uid,
    workoutCount: workouts.length,
    dayCount: plan.length,
    staleDayCount: staleDayIds.length,
  }
  log(
    `${base.mode}: ${base.workoutCount} treinos, ${base.dayCount} dias, ${base.staleDayCount} resumos obsoletos para ${uid}.`
  )
  if (!apply) return { ...base, written: 0, deleted: 0, failed: 0 }

  const result = await applyPlan(uid, plan, staleDayIds)
  const summary = { ...base, ...result }
  log(
    `APPLY concluído: ${summary.written} gravados, ${summary.deleted} removidos, ${summary.failed} falhas.`
  )
  if (summary.failed) {
    const error = new Error(`Backfill incompleto: ${summary.failed} operações falharam.`)
    error.result = summary
    throw error
  }
  return summary
}
