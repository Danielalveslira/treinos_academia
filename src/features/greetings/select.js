import { CATALOG_VERSION, getPool } from './catalog.js'
import { formatGreetingText } from './format.js'

// Escolha DETERMINÍSTICA e sem I/O. Nada de Math.random()/Date.now(): a mesma pessoa, categoria, voz e dia de
// negócio sempre caem na mesma frase (F5, outra aba, outro aparelho), e dias seguidos percorrem uma
// permutação fixa da pool -- sem repetir antes de esgotá-la.

const DAY_MS = 86_400_000

// FNV-1a 32 bits: pequeno, estável entre navegadores e suficiente para espalhar sementes.
export function hashString(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

// mulberry32: gerador pseudoaleatório minúsculo e determinístico.
export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 'YYYY-MM-DD' -> nº de dias desde 1970 (aritmética UTC de data pura: o fuso do aparelho não entra).
export function dayOrdinal(dayKey) {
  const [year, month, day] = dayKey.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS)
}

const permutations = new Map()
const PERMUTATION_CACHE_LIMIT = 64

function permutationFor(userId, category, voice) {
  const key = `${userId}|${category}|${voice}|${CATALOG_VERSION}`
  let permutation = permutations.get(key)
  if (!permutation) {
    permutation = [...getPool(category, voice)] // já ordenada por ID
    const random = mulberry32(hashString(key))
    for (let index = permutation.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1))
      ;[permutation[index], permutation[swap]] = [permutation[swap], permutation[index]]
    }
    if (permutations.size >= PERMUTATION_CACHE_LIMIT) permutations.clear()
    permutations.set(key, permutation)
  }
  return permutation
}

// Prioridade (da mais para a menos forte). `first_workout` não existe aqui de propósito: a Home só carrega a
// primeira página de treinos e não há contagem total confiável sem consulta extra -- melhor não afirmar.
// Estados vindos do PLANO (rest/planned/return) só valem com histórico confiável: sem ele, saudação por período.
export function selectGreetingCategory({
  welcomeActive = false,
  todayState,
  reminderDue = false,
  daysSinceLastActivity = null,
  hasActivityData = true,
  timePeriod,
}) {
  if (todayState === 'completed') return 'completed'
  if (todayState === 'in_progress') return 'in_progress'
  if (welcomeActive) return 'welcome'
  if (hasActivityData) {
    if (todayState === 'rest') return 'rest'
    if (todayState === 'planned') return reminderDue ? 'planned_due' : 'planned'
    if (daysSinceLastActivity != null && daysSinceLastActivity >= 3) return 'return'
  }
  return timePeriod
}

export function chooseGreetingMessage({ category, voice, userId = '', dayKey }) {
  const permutation = permutationFor(userId ?? '', category, voice)
  // As boas-vindas acontecem uma vez: a semente própria basta, sem avançar por dia.
  const position = category === 'welcome' ? 0 : dayOrdinal(dayKey) % permutation.length
  return permutation[position]
}

// Contexto -> o que a UI desenha (e só isso).
export function greetingFromContext(context, userId) {
  const message = chooseGreetingMessage({
    category: context.category,
    voice: context.voice,
    userId,
    dayKey: context.dayKey,
  })
  return {
    id: message.id,
    eyebrow: message.eyebrow,
    heading: formatGreetingText(message.text, context.firstName, message.maxNameLength),
    category: context.category,
    trainedToday: context.category === 'completed',
    isWelcome: context.category === 'welcome',
  }
}
