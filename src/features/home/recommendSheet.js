import { addDaysToDayKey } from '../../utils/businessDate.js'
// Completion is explicit server evidence; registered activity only establishes progress.
// Production receives all-time last dates and month day counts from get_my_sheet_insights.
function stableOrder(a, b) {
  return a.sort_order - b.sort_order || String(a.id).localeCompare(String(b.id), 'en')
}

function isRecommendable(sheet) {
  return !sheet.archived_at && Number(sheet.exercise_count) > 0 && sheet.available !== false
}

export function sheetState(sheet, activityIndex, todayKey) {
  if (!isRecommendable(sheet)) return 'unavailable'
  if (sheet.completed_today === true) return 'completed'
  return activityIndex.get(sheet.id)?.lastDate === todayKey ? 'in_progress' : 'not_started'
}

export function daysBetweenKeys(fromKey, toKey) {
  const toDays = (key) =>
    Date.UTC(
      ...key
        .split('-')
        .map(Number)
        .map((n, i) => (i === 1 ? n - 1 : n))
    ) / 86_400_000
  return Math.round(toDays(toKey) - toDays(fromKey))
}

// "hoje" / "ontem" / "há N dias" -- usado nas duas linhas de última execução do painel da Home.
export function relativeDayLabel(dateKey, todayKey) {
  if (!dateKey) return null
  const diff = daysBetweenKeys(dateKey, todayKey)
  if (diff <= 0) return 'hoje'
  if (diff === 1) return 'ontem'
  return `há ${diff} dias`
}

// { lastDate, monthDays } por sheetId -- monthDays só conta dias dentro de [monthStartKey, ...].
export function buildSheetActivityIndex(activity, monthStartKey) {
  const bySheet = new Map()
  for (const { sheetId, date, monthDays, lastRegisteredAt } of activity || []) {
    if (!sheetId || !date) continue
    let entry = bySheet.get(sheetId)
    if (!entry) {
      entry = { lastDate: null, monthDays: new Set() }
      bySheet.set(sheetId, entry)
    }
    if (!entry.lastDate || date > entry.lastDate) entry.lastDate = date
    if (Number.isInteger(monthDays)) entry.monthCount = monthDays
    if (lastRegisteredAt) entry.lastRegisteredAt = lastRegisteredAt
    if (date >= monthStartKey && date.slice(0, 7) === monthStartKey.slice(0, 7))
      entry.monthDays.add(date)
  }
  return bySheet
}

function daysSinceLast(sheet, activityIndex, todayKey) {
  const last = activityIndex.get(sheet.id)?.lastDate
  return last ? daysBetweenKeys(last, todayKey) : Infinity
}

// Mais tempo sem treinar primeiro ("nunca" vence qualquer data real); empate = ordem do usuário.
function byOverdueThenOrder(activityIndex, todayKey) {
  return (a, b) => {
    const da = daysSinceLast(a, activityIndex, todayKey)
    const db = daysSinceLast(b, activityIndex, todayKey)
    if (da !== db) return da === Infinity ? -1 : db === Infinity ? 1 : db - da
    return stableOrder(a, b)
  }
}

function daysUntilWeekday(todayWeekday, weekdays) {
  const set = new Set(weekdays)
  for (let delta = 1; delta <= 7; delta += 1) {
    if (set.has((todayWeekday + delta) % 7)) return delta
  }
  return Infinity // weekdays não vazio: nunca deveria cair aqui
}

// { sheet, reason: 'today'|'scheduled'|'fallback', lastDate, nextInDays? } ou null sem ficha elegível.
export function recommendSheet(sheets, activityIndex, todayKey) {
  const pool = (sheets || []).filter(isRecommendable)
  if (!pool.length) return null
  const todayWeekday = new Date(`${todayKey}T12:00:00Z`).getUTCDay()
  const lastDateOf = (sheet) => activityIndex.get(sheet.id)?.lastDate || null

  const stateOf = (sheet) => sheetState(sheet, activityIndex, todayKey)
  const pending = pool.filter((sheet) => stateOf(sheet) !== 'completed')
  const underway = pending
    .filter((sheet) => stateOf(sheet) === 'in_progress')
    .sort(
      (a, b) =>
        Number((b.weekdays || []).includes(todayWeekday)) -
          Number((a.weekdays || []).includes(todayWeekday)) || stableOrder(a, b)
    )
  if (underway.length)
    return {
      sheet: underway[0],
      reason: 'in_progress',
      state: 'in_progress',
      lastDate: lastDateOf(underway[0]),
    }
  const scheduledToday = pending.filter((sheet) => (sheet.weekdays || []).includes(todayWeekday))
  if (scheduledToday.length) {
    const sheet = [...scheduledToday].sort(byOverdueThenOrder(activityIndex, todayKey))[0]
    return { sheet, reason: 'today', state: 'not_started', lastDate: lastDateOf(sheet) }
  }

  const withSchedule = pool.filter((sheet) => (sheet.weekdays || []).length > 0)
  if (withSchedule.length) {
    const sheet = [...withSchedule].sort((a, b) => {
      const diff =
        daysUntilWeekday(todayWeekday, a.weekdays) - daysUntilWeekday(todayWeekday, b.weekdays)
      return diff !== 0 ? diff : stableOrder(a, b)
    })[0]
    return {
      sheet,
      reason: 'scheduled',
      lastDate: lastDateOf(sheet),
      nextInDays: daysUntilWeekday(todayWeekday, sheet.weekdays),
      nextDate: addDaysToDayKey(todayKey, daysUntilWeekday(todayWeekday, sheet.weekdays)),
      completedToday: pool.some((s) => s.completed_today),
    }
  }

  if (!pending.length) return { reason: 'completed', completedToday: true }
  const sheet = [...pending].sort(byOverdueThenOrder(activityIndex, todayKey))[0]
  return { sheet, reason: 'fallback', lastDate: lastDateOf(sheet) }
}

// { sheet, date } da ficha com a execução mais recente, ou null sem nenhuma.
export function lastTrainedSheet(sheets, activityIndex) {
  let best = null
  for (const sheet of sheets || []) {
    const date = activityIndex.get(sheet.id)?.lastDate
    const at = activityIndex.get(sheet.id)?.lastRegisteredAt || ''
    if (
      date &&
      (!best ||
        date > best.date ||
        (date === best.date &&
          (at > best.at || (at === best.at && stableOrder(sheet, best.sheet) < 0))))
    )
      best = { sheet, date, at }
  }
  return best
}

// { sheet, count, lastDate } da ficha com mais dias distintos treinados no mês corrente.
// Empate: a mais recente; ainda empatado, a ordem do usuário. Sem nenhum treino no mês: null.
export function mostTrainedThisMonth(sheets, activityIndex) {
  let best = null
  for (const sheet of sheets || []) {
    const entry = activityIndex.get(sheet.id)
    const count = entry?.monthCount ?? entry?.monthDays.size ?? 0
    if (!count) continue
    const candidate = { sheet, count, lastDate: entry.lastDate, at: entry.lastRegisteredAt || '' }
    if (
      !best ||
      count > best.count ||
      (count === best.count &&
        (candidate.lastDate > best.lastDate ||
          (candidate.lastDate === best.lastDate &&
            (candidate.at > best.at ||
              (candidate.at === best.at && stableOrder(sheet, best.sheet) < 0)))))
    )
      best = candidate
  }
  return best
}
