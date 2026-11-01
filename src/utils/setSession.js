import { isValidSet, MAX_WORKOUT_SETS } from './workoutSets.js'
import { suggestedSets } from './setSuggestions.js'

// Modelo de séries do registro de treino (WorkoutForm/SetCard). Cada série da sessão é:
//   { key, weight, reps, source, done, committed, suggested }
// - weight/reps: o que está nos campos agora (strings, vírgula já normalizada para ponto);
// - source: de onde vieram os valores — 'empty' (nada sugerido), 'history' (último treino),
//   'inherited' (série anterior) ou 'manual' (digitado). Sugestão NUNCA é registro concluído;
// - done/committed: série concluída e os valores que foram registrados. Editar os campos de uma série
//   concluída não altera `committed` até confirmar (assim o que é salvo nunca é um rascunho);
// - suggested: a sugestão do histórico para esta posição (ou null), usada para saber se o usuário se
//   afastou dela.

// Sem histórico não há como saber quantas séries o usuário faz; três é o padrão de quem começa e dá
// sentido a "Série 1 de 3". Os campos continuam vazios — a quantidade não é um valor de treino.
export const DEFAULT_SET_COUNT = 3

export function setValueKey(set) {
  return `${Number(set.weight)}|${Number(set.reps)}`
}

function sameValues(a, b) {
  return Boolean(a && b && isValidSet(a) && isValidSet(b) && setValueKey(a) === setValueKey(b))
}

export function buildSessionSets(historyWorkout, nextKey, targetSets = null) {
  const fromHistory = suggestedSets(historyWorkout)
  const planned =
    Number.isInteger(Number(targetSets)) && Number(targetSets) > 0
      ? Math.min(MAX_WORKOUT_SETS, Number(targetSets))
      : null
  const sets = fromHistory.some((set) => set.source === 'history')
    ? fromHistory.slice(0, planned || MAX_WORKOUT_SETS)
    : []
  const desiredCount = planned || sets.length || DEFAULT_SET_COUNT
  while (sets.length < desiredCount) sets.push({ weight: '', reps: '', source: 'empty' })
  return sets.map((set) => ({
    ...set,
    key: nextKey(),
    done: false,
    committed: null,
    suggested: set.source === 'history' ? { weight: set.weight, reps: set.reps } : null,
  }))
}

// Confirmed rows have no client-side set keys. Rebuild them in their saved order, then
// keep planned positions available without treating suggestions as completed work.
export function restoreSessionSets(workout, historyWorkout, nextKey, targetSets = null) {
  const confirmed = (workout?.setDetails || []).filter(isValidSet)
  const suggested = buildSessionSets(historyWorkout, nextKey, targetSets)
  const count =
    workout?.exerciseCompleted === true
      ? confirmed.length
      : Math.max(confirmed.length, suggested.length)
  return Array.from({ length: count }, (_, index) => {
    const saved = confirmed[index]
    if (!saved) return suggested[index]
    const committed = { weight: String(saved.weight), reps: String(saved.reps) }
    return {
      key: suggested[index]?.key ?? nextKey(),
      ...committed,
      source: 'manual',
      done: true,
      committed,
      suggested: null,
    }
  })
}

// Edição de um registro existente: tudo já foi registrado.
export function buildEditSets(sets, nextKey) {
  return sets.map((set) => ({
    weight: String(set.weight ?? ''),
    reps: String(set.reps ?? ''),
    source: 'manual',
    key: nextKey(),
    done: true,
    committed: { weight: String(set.weight ?? ''), reps: String(set.reps ?? '') },
    suggested: null,
  }))
}

// Próxima série pendente depois de `from`; se não houver, a primeira pendente de todas; -1 se nenhuma.
export function nextPendingIndex(sets, from) {
  for (let index = from + 1; index < sets.length; index += 1) if (!sets[index].done) return index
  return sets.findIndex((set) => !set.done)
}

export function isSetDirty(set) {
  return Boolean(set?.done && !sameValues(set, set.committed))
}

export function updateSetField(sets, key, field, value) {
  return sets.map((set) => (set.key === key ? { ...set, [field]: value, source: 'manual' } : set))
}

// Conclui a série `index`. As séries seguintes ainda intocadas herdam os valores — exceto as que trazem
// sugestão do histórico quando o usuário NÃO se afastou da sugestão desta série (progressão por série é
// preservada). Devolve null se a série não é válida ou já está concluída (toque repetido).
export function concludeSet(sets, index) {
  const current = sets[index]
  if (!current || current.done || !isValidSet(current)) return null
  const committed = { weight: current.weight, reps: current.reps }
  const overridden = !sameValues(committed, current.suggested)
  const next = sets.map((set, position) => {
    if (position === index) return { ...set, done: true, committed }
    if (position > index && !set.done && set.source !== 'manual') {
      if (set.source === 'history' && !overridden) return set
      return { ...set, ...committed, source: 'inherited' }
    }
    return set
  })
  return {
    sets: next,
    nextIndex: nextPendingIndex(next, index),
    finished: next.every((s) => s.done),
  }
}

// Confirma a edição de uma série já concluída (sem mexer nas demais).
export function commitSetEdit(sets, index) {
  const current = sets[index]
  if (!current?.done || !isValidSet(current)) return null
  return sets.map((set, position) =>
    position === index ? { ...set, committed: { weight: set.weight, reps: set.reps } } : set
  )
}

export function addSet(sets, nextKey) {
  if (sets.length >= MAX_WORKOUT_SETS) return sets
  const last = sets.at(-1)
  const carry = last && isValidSet(last)
  return [
    ...sets,
    {
      weight: carry ? last.weight : '',
      reps: carry ? last.reps : '',
      source: carry ? 'inherited' : 'empty',
      key: nextKey(),
      done: false,
      committed: null,
      suggested: null,
    },
  ]
}

export function canRemoveSet(sets, key) {
  const target = sets.find((set) => set.key === key)
  if (!target || sets.length <= 1) return false
  // Uma série concluída só sai se sobrar outra concluída: o registro salvo nunca fica sem séries.
  return !target.done || sets.filter((set) => set.done).length > 1
}

export function removeSet(sets, key) {
  return canRemoveSet(sets, key) ? sets.filter((set) => set.key !== key) : sets
}

// "Finalizar com N séries": descarta as pendentes. Exige ao menos uma concluída.
export function dropPendingSets(sets) {
  return sets.some((set) => set.done) ? sets.filter((set) => set.done) : sets
}

export function doneSetsPayload(sets) {
  return sets
    .filter((set) => set.done)
    .map((set) => ({ key: set.key, weight: set.committed.weight, reps: set.committed.reps }))
}

export function allSetsDone(sets) {
  return sets.length > 0 && sets.every((set) => set.done)
}

// Estado de gravação de uma série concluída, a partir do estado da linha (ver rowSaver.js):
// 'saved' | 'local' (guardada neste aparelho, aguardando sincronizar) | 'saving' | 'error' | null.
export function setSyncStatus(set, row) {
  if (!set.done) return null
  if (row?.persisted?.[set.key] === setValueKey(set.committed))
    return row.pendingSync ? 'local' : 'saved'
  return row?.status === 'error' ? 'error' : 'saving'
}

// Rótulo curto da origem dos valores — null quando não há nada a explicar.
export function setSourceLabel(set) {
  if (set.done) return null
  if (set.source === 'history') return 'Sugerido do último treino'
  if (set.source === 'inherited') return 'Igual à série anterior'
  return null
}

// Resumo de uma lista de estados de gravação (o pior primeiro): usado no painel de exercício concluído.
export function aggregateSyncStatus(statuses) {
  const present = statuses.filter(Boolean)
  for (const status of ['error', 'saving', 'local']) if (present.includes(status)) return status
  return present.length ? 'saved' : null
}

// Estado de gravação de um registro cardio (uma linha, sem séries).
export function rowSyncStatus(row) {
  if (!row || row.status === 'idle' || row.status === 'saving') return 'saving'
  if (row.status === 'error') return 'error'
  return row.pendingSync ? 'local' : 'saved'
}
