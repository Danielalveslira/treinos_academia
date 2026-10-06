import { attempt, iterate, request, withTransaction } from './database.js'
import { STORES } from './schema.js'

// Cache LOCAL do catálogo PÚBLICO (public.exercise_catalog, ~868 linhas, leitura anônima): sem
// user_id, sobrevive a logout/troca de conta. Não é a fonte oficial -- é preenchido de forma
// oportunista com o que o servidor já devolveu (busca/detalhe/taxonomia), sem baixar o catálogo
// inteiro no boot. Registros guardados no formato do app (mapRow de exerciseCatalogService), então
// a UI lê exatamente a mesma forma online e offline.
//
// Toda função pública NUNCA lança: falha de IndexedDB vira "sem cache" (false/undefined).

const MAX_SEARCH_LIMIT = 50 // mesmo teto da RPC (least(greatest(p_limit, 1), 50))
const ENTRY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const TAXONOMY_KEY = 'catalog:taxonomy'

// Equivale a public._normalize_search_value: minúsculas, sem acento, espaços colapsados.
export function normalizeSearchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function toRecord(exercise, cachedAt) {
  return {
    id: exercise.id,
    provider: exercise.provider ?? null,
    providerExerciseId: exercise.providerExerciseId ?? null,
    name: exercise.name,
    nameKey: normalizeSearchValue(exercise.name),
    primaryMuscles: exercise.primaryMuscles || [],
    secondaryMuscles: exercise.secondaryMuscles || [],
    equipment: exercise.equipment ?? null,
    category: exercise.category ?? null,
    level: exercise.level ?? null,
    force: exercise.force ?? null,
    mechanic: exercise.mechanic ?? null,
    instructions: exercise.instructions || [],
    images: exercise.images || [],
    cachedAt,
  }
}

function toExercise(record) {
  const { nameKey: _nameKey, cachedAt: _cachedAt, ...exercise } = record
  return exercise
}

function isValid(exercise) {
  return Boolean(
    exercise && typeof exercise.id === 'string' && exercise.id && typeof exercise.name === 'string'
  )
}

// Upsert por id (nunca duplica). Se o mesmo provider/providerExerciseId reaparece com OUTRO id
// (linha recriada no catálogo), o registro antigo sai na mesma transação. Registros mais velhos
// que ENTRY_MAX_AGE_MS (não reconfirmados pelo servidor) são removidos: item desativado no
// catálogo não fica para sempre.
export function cacheCatalogEntries(exercises, now = Date.now()) {
  const valid = (exercises || []).filter(isValid)
  if (valid.length === 0) return Promise.resolve(false)
  return attempt(
    'catalog:write',
    async () => {
      await withTransaction([STORES.exerciseCatalog], 'readwrite', async ({ exerciseCatalog }) => {
        const byProvider = exerciseCatalog.index('byProvider')
        for (const exercise of valid) {
          const record = toRecord(exercise, now)
          if (record.provider && record.providerExerciseId) {
            const clashes = await request(
              byProvider.getAllKeys([record.provider, record.providerExerciseId])
            )
            for (const key of clashes) if (key !== record.id) exerciseCatalog.delete(key)
          }
          exerciseCatalog.put(record)
        }
        await iterate(
          exerciseCatalog.index('byCachedAt'),
          IDBKeyRange.upperBound(now - ENTRY_MAX_AGE_MS, true),
          'next',
          (cursor) => {
            cursor.delete()
          },
          { keysOnly: false }
        )
      })
      return true
    },
    false
  )
}

// Mesma semântica da RPC search_exercise_catalog, MENOS a busca aproximada por trigrama
// (aqui é "o nome contém o termo", sem acento/caixa). Ordena por nome. Devolve undefined quando
// não há NENHUM resultado local -- um "nenhum exercício" vindo de um cache parcial seria
// enganoso; quem chama então propaga o erro real de rede.
export function searchCachedCatalog({
  q,
  category,
  muscle,
  equipment,
  level,
  limit = 20,
  offset = 0,
} = {}) {
  return attempt(
    'catalog:search',
    async () => {
      const records = await withTransaction(
        [STORES.exerciseCatalog],
        'readonly',
        ({ exerciseCatalog }) => request(exerciseCatalog.getAll())
      )
      const term = normalizeSearchValue(q)
      const matches = records.filter(
        (record) =>
          (!category || record.category === category) &&
          (!equipment || record.equipment === equipment) &&
          (!level || record.level === level) &&
          (!muscle ||
            record.primaryMuscles.includes(muscle) ||
            record.secondaryMuscles.includes(muscle)) &&
          (!term || record.nameKey.includes(term))
      )
      if (matches.length === 0) return undefined
      matches.sort((a, b) => a.nameKey.localeCompare(b.nameKey) || a.name.localeCompare(b.name))
      const size = Math.min(Math.max(Number(limit) || 1, 1), MAX_SEARCH_LIMIT)
      const start = Math.max(Number(offset) || 0, 0)
      return { data: matches.slice(start, start + size).map(toExercise), total: matches.length }
    },
    undefined
  )
}

// Mesma regra do servidor: catalogId (PK) ou provider + providerExerciseId. undefined = não está
// no cache (NÃO significa que não existe no catálogo).
export function readCachedCatalogEntry({ catalogId, provider, providerExerciseId } = {}) {
  return attempt(
    'catalog:detail',
    async () =>
      withTransaction([STORES.exerciseCatalog], 'readonly', async ({ exerciseCatalog }) => {
        let record
        if (catalogId) record = await request(exerciseCatalog.get(catalogId))
        else if (provider && providerExerciseId) {
          const found = await request(
            exerciseCatalog.index('byProvider').getAll([provider, providerExerciseId], 1)
          )
          record = found[0]
        }
        return record ? toExercise(record) : undefined
      }),
    undefined
  )
}

export function cacheCatalogTaxonomy(taxonomy, now = Date.now()) {
  if (!taxonomy || typeof taxonomy !== 'object') return Promise.resolve(false)
  return attempt(
    'catalog:taxonomy-write',
    async () => {
      await withTransaction([STORES.syncMeta], 'readwrite', ({ syncMeta }) =>
        request(syncMeta.put({ key: TAXONOMY_KEY, value: taxonomy, storedAt: now }))
      )
      return true
    },
    false
  )
}

export function readCachedCatalogTaxonomy() {
  return attempt(
    'catalog:taxonomy-read',
    () =>
      withTransaction([STORES.syncMeta], 'readonly', async ({ syncMeta }) => {
        const record = await request(syncMeta.get(TAXONOMY_KEY))
        return record?.value
      }),
    undefined
  )
}
