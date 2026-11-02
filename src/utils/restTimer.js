// Cronômetro de descanso entre séries — funções puras + persistência mínima em sessionStorage.
//
// A fonte da verdade é o instante absoluto de término (`endsAt`): o tempo restante é sempre recalculado a
// partir de Date.now(), então timers atrasados ou suspensos (aba em segundo plano, tela bloqueada) nunca
// acumulam erro. É só um auxílio de interface: nada aqui toca registro, sincronização ou banco.

// Mesmo limite do editor de fichas (workoutSheetValidation.js: rest_seconds 0–900).
export const MAX_REST_SECONDS = 900
// Descanso não configurado na ficha (rest_seconds nulo) usa o padrão; 0 desativa.
export const DEFAULT_REST_SECONDS = 90
export const REST_EXTEND_SECONDS = 15
// Teto para acréscimos sucessivos de +15s numa mesma contagem.
export const MAX_TOTAL_REST_SECONDS = MAX_REST_SECONDS * 2
// Quanto tempo "Descanso concluído" fica visível antes de o indicador sair.
export const REST_DONE_DISPLAY_MS = 4000

const STORAGE_KEY = 'evolutus:rest-timer'
const STORAGE_VERSION = 1

// null/ausente → padrão; números fora da faixa são limitados a [0, 900]; lixo → padrão.
export function normalizeRestSeconds(value) {
  if (value == null || value === '') return DEFAULT_REST_SECONDS
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return DEFAULT_REST_SECONDS
  return Math.min(MAX_REST_SECONDS, Math.max(0, Math.round(seconds)))
}

// Opções rápidas da preferência "Descanso padrão entre séries".
export const REST_PRESETS = [30, 60, 90, 120]

// Valor configurado (exercício ou usuário) ou null quando não há escolha. Só inteiros 0–900 contam —
// 0 é uma escolha (desativado), nunca "ausente". '', null, undefined e lixo = não configurado.
export function configuredRestSeconds(value) {
  // Só número ou texto numérico: Number([]), Number(false) e Number(' ') valem 0 e virariam "desativado".
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value.trim())) return null
  } else if (typeof value !== 'number') return null
  const seconds = Number(value)
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= MAX_REST_SECONDS ? seconds : null
}

// Prioridade: 1) tempo do exercício na ficha; 2) padrão do usuário; 3) padrão do sistema (90s).
export function resolveRestSeconds(exerciseRestSeconds, userDefaultRestSeconds) {
  return (
    configuredRestSeconds(exerciseRestSeconds) ??
    configuredRestSeconds(userDefaultRestSeconds) ??
    DEFAULT_REST_SECONDS
  )
}

// Nova contagem; null quando o descanso está desativado (0) ou faltam dados.
export function createRest({ scope, exerciseId, setKey = null, restSeconds, now = Date.now() }) {
  const durationSeconds = normalizeRestSeconds(restSeconds)
  if (!scope || !exerciseId || durationSeconds === 0) return null
  return {
    id: `${exerciseId}:${now}`,
    scope,
    exerciseId,
    setKey,
    durationSeconds,
    endsAt: now + durationSeconds * 1000,
  }
}

export function remainingSeconds(rest, now = Date.now()) {
  if (!rest) return 0
  return Math.max(0, Math.ceil((rest.endsAt - now) / 1000))
}

export function isRestExpired(rest, now = Date.now()) {
  return !rest || now >= rest.endsAt
}

// Fração já decorrida (0 → 1), para a barra de progresso.
export function restProgress(rest, now = Date.now()) {
  if (!rest || rest.durationSeconds <= 0) return 1
  const elapsed = rest.durationSeconds * 1000 - (rest.endsAt - now)
  return Math.min(1, Math.max(0, elapsed / (rest.durationSeconds * 1000)))
}

// +15s: soma ao término (ou a partir de agora, se já acabou) e à duração usada pela barra.
export function extendRest(rest, seconds = REST_EXTEND_SECONDS, now = Date.now()) {
  if (!rest) return null
  const room = MAX_TOTAL_REST_SECONDS - rest.durationSeconds
  const added = Math.max(0, Math.min(seconds, room))
  if (added === 0) return rest
  return {
    ...rest,
    durationSeconds: rest.durationSeconds + added,
    endsAt: Math.max(rest.endsAt, now) + added * 1000,
  }
}

// "01:12"
export function formatRestClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

// "1min30s", "2min", "45s"; 0 = "Sem descanso"
export function formatRestDuration(totalSeconds) {
  if (totalSeconds === 0) return 'Sem descanso'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (!minutes) return `${seconds}s`
  return seconds ? `${minutes}min${seconds}s` : `${minutes}min`
}

// Valida o que veio do storage: mesmo escopo (usuário + ficha + dia), formato íntegro, ainda não
// expirado e sem término absurdo no futuro (relógio alterado, dado adulterado). Qualquer dúvida → null.
export function parseStoredRest(raw, scope, now = Date.now()) {
  if (!raw || !scope) return null
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || data.v !== STORAGE_VERSION) return null
  const { scope: storedScope, exerciseId, durationSeconds, endsAt } = data
  if (storedScope !== scope) return null
  if (typeof exerciseId !== 'string' || !exerciseId) return null
  if (
    !Number.isInteger(durationSeconds) ||
    durationSeconds < 1 ||
    durationSeconds > MAX_TOTAL_REST_SECONDS
  )
    return null
  if (!Number.isFinite(endsAt) || endsAt <= now || endsAt - now > durationSeconds * 1000)
    return null
  // A chave da série é só da montagem anterior (o cliente as regenera): não sobrevive ao reload.
  return { id: `${exerciseId}:${endsAt}`, scope, exerciseId, setKey: null, durationSeconds, endsAt }
}

function serializeRest(rest) {
  return JSON.stringify({
    v: STORAGE_VERSION,
    scope: rest.scope,
    exerciseId: rest.exerciseId,
    durationSeconds: rest.durationSeconds,
    endsAt: rest.endsAt,
  })
}

// Storage bloqueado/indisponível nunca quebra nada: o cronômetro só deixa de sobreviver ao reload.
export function loadStoredRest(scope, now = Date.now(), storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const rest = parseStoredRest(raw, scope, now)
    // Registro de outro treino/usuário, expirado ou inválido: descarta para não ser lido de novo.
    if (!rest) storage.removeItem(STORAGE_KEY)
    return rest
  } catch {
    return null
  }
}

export function saveStoredRest(rest, storage = globalThis.sessionStorage) {
  try {
    if (rest) storage?.setItem(STORAGE_KEY, serializeRest(rest))
    else storage?.removeItem(STORAGE_KEY)
  } catch {
    // Sem storage: a contagem segue só em memória.
  }
}

export function clearStoredRest(storage = globalThis.sessionStorage) {
  saveStoredRest(null, storage)
}
