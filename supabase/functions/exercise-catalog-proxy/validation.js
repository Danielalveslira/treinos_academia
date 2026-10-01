// Lógica pura de validação dos parâmetros de busca -- extraída de index.ts pra ser
// testável com node --test (Deno não está disponível neste ambiente de CI/dev). Importada
// pela própria Edge Function via caminho relativo (Deno também entende JS puro sem
// especificador nenhum, só módulos npm/jsr precisam de prefixo).
export const CATEGORIES = [
  'strength', 'yoga', 'mobility', 'physical_therapy', 'stretching', 'pilates',
  'calisthenics', 'plyometrics', 'conditioning', 'olympic_weightlifting', 'powerlifting', 'strongman',
]
export const LEVELS = ['beginner', 'intermediate', 'advanced']
export const FORCES = ['push', 'pull', 'static']
export const MECHANICS = ['compound', 'isolation']
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/
export const FREE_TEXT_PATTERN = /^[\p{L}\p{N} .,'()_-]{1,100}$/u
export const MAX_LIMIT = 50
export const MAX_OFFSET = 500

// Devolve { search: URLSearchParams } em caso de sucesso, ou { error: 'CODE' } --
// nunca lança, pra facilitar tanto o uso na Edge Function quanto em teste.
export function validateSearchParams(params) {
  const search = new URLSearchParams()

  if (params.q !== undefined) {
    if (typeof params.q !== 'string' || params.q.length < 1 || params.q.length > 200) {
      return { error: 'INVALID_QUERY' }
    }
    search.set('q', params.q)
  }
  if (params.category !== undefined) {
    if (typeof params.category !== 'string' || !CATEGORIES.includes(params.category)) {
      return { error: 'INVALID_CATEGORY' }
    }
    search.set('category', params.category)
  }
  if (params.muscle !== undefined) {
    if (typeof params.muscle !== 'string' || !FREE_TEXT_PATTERN.test(params.muscle)) {
      return { error: 'INVALID_MUSCLE' }
    }
    search.set('muscle', params.muscle)
  }
  if (params.equipment !== undefined) {
    if (typeof params.equipment !== 'string' || !FREE_TEXT_PATTERN.test(params.equipment)) {
      return { error: 'INVALID_EQUIPMENT' }
    }
    search.set('equipment', params.equipment)
  }
  if (params.level !== undefined) {
    if (typeof params.level !== 'string' || !LEVELS.includes(params.level)) return { error: 'INVALID_LEVEL' }
    search.set('level', params.level)
  }
  if (params.force !== undefined) {
    if (typeof params.force !== 'string' || !FORCES.includes(params.force)) return { error: 'INVALID_FORCE' }
    search.set('force', params.force)
  }
  if (params.mechanic !== undefined) {
    if (typeof params.mechanic !== 'string' || !MECHANICS.includes(params.mechanic)) {
      return { error: 'INVALID_MECHANIC' }
    }
    search.set('mechanic', params.mechanic)
  }
  if (params.hasVideo !== undefined) {
    if (typeof params.hasVideo !== 'boolean') return { error: 'INVALID_HAS_VIDEO' }
    search.set('hasVideo', String(params.hasVideo))
  }

  const limit = Number.isInteger(params.limit) ? params.limit : 20
  if (limit < 1 || limit > MAX_LIMIT) return { error: 'INVALID_LIMIT' }
  search.set('limit', String(limit))

  const offset = Number.isInteger(params.offset) ? params.offset : 0
  if (offset < 0 || offset > MAX_OFFSET) return { error: 'INVALID_OFFSET' }
  search.set('offset', String(offset))

  return { search }
}

export function validateDetailId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

// Lê um orçamento (EXERCISEAPI_MINUTE_BUDGET/EXERCISEAPI_DAILY_BUDGET) configurado como
// secret -- nunca hardcoded no código, pra poder ajustar sem novo deploy se o plano
// contratado mudar. Ausente/inválido cai num fallback conservador (bem abaixo do teto
// oficial do plano Pro: 300/min, 10.000/dia) -- nunca zero, pra uma secret esquecida não
// derrubar o catálogo inteiro, mas sempre com folga de segurança.
export function parseBudget(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

// A ExerciseAPI devolve dois códigos de 429 diferentes: RATE_LIMIT_EXCEEDED (teto normal)
// e OVERAGE_CAP_EXCEEDED (10x acima do plano -- bem mais grave). Repassa o real, nunca
// colapsa os dois num código genérico só, pra logs/alertas conseguirem diferenciar.
export function mapProviderRateLimitCode(providerCode) {
  return providerCode === 'OVERAGE_CAP_EXCEEDED' ? 'PROVIDER_OVERAGE_CAP_EXCEEDED' : 'PROVIDER_RATE_LIMITED'
}
