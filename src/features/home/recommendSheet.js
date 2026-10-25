// Motor de recomendação da Home: tudo puro (sem I/O), testável sem React nem rede. Entradas:
//  - sheets: fichas ATIVAS do usuário (list_my_workout_sheets, já sem arquivadas), cada uma com
//    { id, name, goal, weekdays, sort_order, exercise_count }.
//  - activity: linhas { sheetId, date } de workouts.sheet_id (ver listSheetActivitySince), já
//    restritas à janela buscada (ver useSheetInsights.js) -- nunca o histórico inteiro.
//  - todayKey/monthStartKey: chaves 'YYYY-MM-DD' do dia de negócio (America/Sao_Paulo).
//
// Regras (na ordem -- ver docs/prompts, seção "Regras da recomendação"):
//  1. Fichas ativas programadas para HOJE, priorizando a que está há mais tempo sem execução.
//  2. Sem ficha para hoje: a próxima pelos dias cadastrados (menor distância, em dias).
//  3. Fichas sem dias definidos: ordem determinística (recência, depois a ordem do usuário).
//  4. Nunca arquivada (já fora de `sheets`) nem vazia (`exercise_count` 0 -- ninguém inicia um
//     rascunho); a disponibilidade de cada exercício é revalidada pelo servidor ao iniciar, como em
//     toda a área de fichas -- esta função só decide QUAL ficha sugerir, nunca libera o início.

function isRecommendable(sheet) {
  return !sheet.archived_at && Number(sheet.exercise_count) > 0
}

export function daysBetweenKeys(fromKey, toKey) {
  const toDays = (key) => Date.UTC(...key.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n))) / 86_400_000
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
  for (const { sheetId, date } of activity || []) {
    if (!sheetId || !date) continue
    let entry = bySheet.get(sheetId)
    if (!entry) {
      entry = { lastDate: null, monthDays: new Set() }
      bySheet.set(sheetId, entry)
    }
    if (!entry.lastDate || date > entry.lastDate) entry.lastDate = date
    if (date >= monthStartKey) entry.monthDays.add(date)
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
    return a.sort_order - b.sort_order
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
  const todayWeekday = new Date(`${todayKey}T12:00:00`).getDay()
  const lastDateOf = (sheet) => activityIndex.get(sheet.id)?.lastDate || null

  const scheduledToday = pool.filter((sheet) => (sheet.weekdays || []).includes(todayWeekday))
  if (scheduledToday.length) {
    const sheet = [...scheduledToday].sort(byOverdueThenOrder(activityIndex, todayKey))[0]
    return { sheet, reason: 'today', lastDate: lastDateOf(sheet) }
  }

  const withSchedule = pool.filter((sheet) => (sheet.weekdays || []).length > 0)
  if (withSchedule.length) {
    const sheet = [...withSchedule].sort((a, b) => {
      const diff = daysUntilWeekday(todayWeekday, a.weekdays) - daysUntilWeekday(todayWeekday, b.weekdays)
      return diff !== 0 ? diff : a.sort_order - b.sort_order
    })[0]
    return { sheet, reason: 'scheduled', lastDate: lastDateOf(sheet), nextInDays: daysUntilWeekday(todayWeekday, sheet.weekdays) }
  }

  const sheet = [...pool].sort(byOverdueThenOrder(activityIndex, todayKey))[0]
  return { sheet, reason: 'fallback', lastDate: lastDateOf(sheet) }
}

// { sheet, date } da ficha com a execução mais recente, ou null sem nenhuma.
export function lastTrainedSheet(sheets, activityIndex) {
  let best = null
  for (const sheet of sheets || []) {
    const date = activityIndex.get(sheet.id)?.lastDate
    if (date && (!best || date > best.date)) best = { sheet, date }
  }
  return best
}

// { sheet, count, lastDate } da ficha com mais dias distintos treinados no mês corrente.
// Empate: a mais recente; ainda empatado, a ordem do usuário. Sem nenhum treino no mês: null.
export function mostTrainedThisMonth(sheets, activityIndex) {
  let best = null
  for (const sheet of sheets || []) {
    const entry = activityIndex.get(sheet.id)
    const count = entry?.monthDays.size || 0
    if (!count) continue
    const candidate = { sheet, count, lastDate: entry.lastDate }
    if (
      !best ||
      count > best.count ||
      (count === best.count &&
        (candidate.lastDate > best.lastDate ||
          (candidate.lastDate === best.lastDate && sheet.sort_order < best.sheet.sort_order)))
    )
      best = candidate
  }
  return best
}
