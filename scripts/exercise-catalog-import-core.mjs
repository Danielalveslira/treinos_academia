// Lógica pura da importação do catálogo (scripts/import-exercise-catalog.mjs) --
// separada da I/O (leitura de arquivo, Supabase) pra ser testável com node --test, no
// mesmo padrão de progress-daily-backfill-core.mjs / economy-vote-counts-backfill-core.mjs.

const PROVIDER = 'evolutus_dataset'

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasNonEmptyTextArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(hasText)
}

// Único critério de "exercício completo" -- reutilizado em toda a importação, nunca
// reimplementado em outro lugar. equipment é OMITIDO de propósito: nem todo exercício
// real tem equipamento (alongamentos, mobilidade), então não é motivo de descarte aqui
// (diferente da tentativa anterior com a ExerciseAPI).
export function isExerciseComplete(raw) {
  return (
    hasText(raw?.id) &&
    hasText(raw?.name) &&
    hasNonEmptyTextArray(raw?.primaryMuscles) &&
    hasText(raw?.category) &&
    hasNonEmptyTextArray(raw?.instructions)
  )
}

export function missingFields(raw) {
  const missing = []
  if (!hasText(raw?.id)) missing.push('id')
  if (!hasText(raw?.name)) missing.push('name')
  if (!hasNonEmptyTextArray(raw?.primaryMuscles)) missing.push('primaryMuscles')
  if (!hasText(raw?.category)) missing.push('category')
  if (!hasNonEmptyTextArray(raw?.instructions)) missing.push('instructions')
  return missing
}

// Nunca inventa dado ausente -- campos opcionais viram null/array vazio quando faltam,
// nunca um valor sintético.
export function normalizeExercise(raw) {
  const secondary = Array.isArray(raw.secondaryMuscles) ? raw.secondaryMuscles.filter(hasText) : []
  const primary = raw.primaryMuscles.filter(hasText)
  const muscles = [...new Set([...primary, ...secondary])]
  const images = Array.isArray(raw.images) ? raw.images.filter(hasText) : []

  return {
    provider: PROVIDER,
    provider_exercise_id: raw.id,
    name: raw.name,
    primary_muscle: primary[0],
    muscles,
    equipment: hasText(raw.equipment) ? raw.equipment : null,
    category: raw.category,
    difficulty: hasText(raw.level) ? raw.level : null,
    force: hasText(raw.force) ? raw.force : null,
    mechanic: hasText(raw.mechanic) ? raw.mechanic : null,
    instructions: raw.instructions.filter(hasText),
    source_media_refs: { images },
  }
}

const COMPARABLE_FIELDS = [
  'name', 'primary_muscle', 'muscles', 'equipment', 'category',
  'difficulty', 'force', 'mechanic', 'instructions', 'source_media_refs',
]

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return (a ?? null) === (b ?? null)
}

function isUnchanged(normalized, existingRow) {
  if (!existingRow) return false
  return COMPARABLE_FIELDS.every((field) => sameValue(normalized[field], existingRow[field]))
}

// Núcleo da importação: recebe o JSON bruto (array) e o mapa de linhas já existentes no
// banco (por provider_exercise_id, pra decidir insert/update/unchanged sem escrever à
// toa) e devolve um plano completo + relatório -- nunca decide sozinho apagar nada.
export function buildImportPlan(rawExercises, existingByProviderExerciseId = new Map()) {
  if (!Array.isArray(rawExercises)) {
    throw new Error('INVALID_SOURCE_FORMAT: esperado um array de exercícios')
  }

  const seenIds = new Map()
  const duplicateIds = []
  const nameCounts = new Map()
  const discarded = []
  const toUpsert = []
  const drift = []
  let inserts = 0
  let updates = 0
  let unchanged = 0
  let withEquipment = 0
  let withMedia = 0

  for (const raw of rawExercises) {
    const name = hasText(raw?.name) ? raw.name.trim() : null
    if (name) {
      const key = name.toLowerCase()
      nameCounts.set(key, (nameCounts.get(key) || []).concat(raw?.id ?? null))
    }

    if (hasText(raw?.id) && seenIds.has(raw.id)) {
      duplicateIds.push(raw.id)
      discarded.push({ id: raw.id, name, reasons: ['duplicate_id_in_source'] })
      continue
    }
    if (hasText(raw?.id)) seenIds.set(raw.id, true)

    if (!isExerciseComplete(raw)) {
      discarded.push({ id: raw?.id ?? null, name, reasons: missingFields(raw) })
      continue
    }

    const normalized = normalizeExercise(raw)
    if (normalized.equipment !== null) withEquipment += 1
    if (normalized.source_media_refs.images.length > 0) withMedia += 1
    const existing = existingByProviderExerciseId.get(normalized.provider_exercise_id)
    if (!existing) {
      inserts += 1
      toUpsert.push(normalized)
    } else if (isUnchanged(normalized, existing)) {
      unchanged += 1
    } else {
      updates += 1
      drift.push({ id: normalized.provider_exercise_id, fields: COMPARABLE_FIELDS.filter((field) => !sameValue(normalized[field], existing[field])) })
    }
  }

  const duplicateNames = [...nameCounts.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([value, ids]) => ({ value, ids }))

  const valid = inserts + updates + unchanged
  return {
    toUpsert,
    report: {
      found: rawExercises.length,
      valid,
      discardedCount: discarded.length,
      discarded,
      duplicateIds,
      duplicateNames,
      withEquipment,
      withoutEquipment: valid - withEquipment,
      withMedia,
      withoutMedia: valid - withMedia,
      inserts,
      updates,
      unchanged,
      drift,
    },
  }
}
