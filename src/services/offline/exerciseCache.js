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

// Marcador do SNAPSHOT COMPLETO (todos os exercícios ativos, não só o que foi consultado
// oportunisticamente). Só existe/complete=true depois de replaceCatalogSnapshot terminar com
// sucesso -- nunca fica "parcialmente completo". Mesma convenção pública de TAXONOMY_KEY
// (sem user_id: é dado anônimo/compartilhável entre contas no mesmo aparelho).
export const CATALOG_SNAPSHOT_KEY = 'catalog:snapshot'
export const CATALOG_SNAPSHOT_SCHEMA_VERSION = 1

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
    thumbnail: exercise.thumbnail ?? null,
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
// catálogo não fica para sempre -- MAS só quando não existe snapshot completo: com complete=true,
// a "verdade" de quem deve sumir é decidida pela PRÓXIMA sincronização completa (replaceCatalogSnapshot),
// nunca por uma poda por idade rodando como efeito colateral de uma leitura oportunista isolada
// (senão uma consulta pontual poderia corromper partes de um snapshot completo sem atualizar `complete`).
export function cacheCatalogEntries(exercises, now = Date.now()) {
  const valid = (exercises || []).filter(isValid)
  if (valid.length === 0) return Promise.resolve(false)
  return attempt(
    'catalog:write',
    async () => {
      await withTransaction(
        [STORES.exerciseCatalog, STORES.syncMeta],
        'readwrite',
        async ({ exerciseCatalog, syncMeta }) => {
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
          const snapshot = (await request(syncMeta.get(CATALOG_SNAPSHOT_KEY)))?.value
          if (snapshot?.complete !== true) {
            await iterate(
              exerciseCatalog.index('byCachedAt'),
              IDBKeyRange.upperBound(now - ENTRY_MAX_AGE_MS, true),
              'next',
              (cursor) => {
                cursor.delete()
              },
              { keysOnly: false }
            )
          }
        }
      )
      return true
    },
    false
  )
}

// Substitui o catálogo local PELO SNAPSHOT COMPLETO (todos os exercícios ativos, já baixados em
// memória por quem chama -- catalogSnapshot.js). Atômico: numa ÚNICA transação, remove o que não
// está mais ativo (não está em `exercises`) e grava tudo + o marcador de integridade. Se qualquer
// `put`/`delete` falhar, a transação aborta e o snapshot ANTERIOR permanece intacto -- nunca existe
// um estado "complete=true" com dados pela metade.
export function replaceCatalogSnapshot(exercises, { revision = null, now = Date.now() } = {}) {
  const valid = (exercises || []).filter(isValid)
  return attempt(
    'catalog:snapshot-write',
    async () => {
      const keepIds = new Set(valid.map((exercise) => exercise.id))
      await withTransaction(
        [STORES.exerciseCatalog, STORES.syncMeta],
        'readwrite',
        async ({ exerciseCatalog, syncMeta }) => {
          const existingKeys = await request(exerciseCatalog.getAllKeys())
          for (const key of existingKeys) if (!keepIds.has(key)) exerciseCatalog.delete(key)
          for (const exercise of valid) exerciseCatalog.put(toRecord(exercise, now))
          syncMeta.put({
            key: CATALOG_SNAPSHOT_KEY,
            value: {
              schemaVersion: CATALOG_SNAPSHOT_SCHEMA_VERSION,
              complete: true,
              revision,
              totalActive: valid.length,
              completedAt: now,
              lastSuccessfulSyncAt: now,
              lastCheckedAt: now,
            },
          })
        }
      )
      return true
    },
    false
  )
}

// Metadado do snapshot completo (undefined = nunca sincronizado completamente neste aparelho).
export function readCatalogSnapshotMeta() {
  return attempt(
    'catalog:snapshot-read',
    () =>
      withTransaction([STORES.syncMeta], 'readonly', async ({ syncMeta }) => {
        const record = await request(syncMeta.get(CATALOG_SNAPSHOT_KEY))
        return record?.value?.schemaVersion === CATALOG_SNAPSHOT_SCHEMA_VERSION
          ? record.value
          : undefined
      }),
    undefined
  )
}

// Só atualiza `lastCheckedAt` (ex.: decidimos que a janela de atualização ainda não abriu, ou uma
// tentativa de sincronização falhou) -- nunca toca `exerciseCatalog` nem os demais campos.
export function touchCatalogSnapshotCheckedAt(now = Date.now()) {
  return attempt(
    'catalog:snapshot-touch',
    async () => {
      await withTransaction([STORES.syncMeta], 'readwrite', async ({ syncMeta }) => {
        const current = (await request(syncMeta.get(CATALOG_SNAPSHOT_KEY)))?.value
        syncMeta.put({
          key: CATALOG_SNAPSHOT_KEY,
          value: { ...(current || { schemaVersion: CATALOG_SNAPSHOT_SCHEMA_VERSION, complete: false, revision: null, totalActive: 0, completedAt: null, lastSuccessfulSyncAt: null }), lastCheckedAt: now },
        })
      })
      return true
    },
    false
  )
}

// Deriva a taxonomia (músculos/equipamentos/categorias/níveis) a partir dos registros já
// guardados localmente -- usada só quando o snapshot está COMPLETO (senão a lista seria parcial
// e enganosa). Função pura, sem IndexedDB, para ser testável isoladamente.
export function deriveCatalogTaxonomyFromSnapshot(records) {
  const muscles = new Set()
  const equipment = new Set()
  const categories = new Set()
  const levels = new Set()
  for (const record of records || []) {
    for (const muscle of record.primaryMuscles || []) muscles.add(muscle)
    for (const muscle of record.secondaryMuscles || []) muscles.add(muscle)
    if (record.equipment) equipment.add(record.equipment)
    if (record.category) categories.add(record.category)
    if (record.level) levels.add(record.level)
  }
  return {
    muscles: [...muscles].sort(),
    equipment: [...equipment].sort(),
    categories: [...categories].sort(),
    levels: [...levels].sort(),
  }
}

// Taxonomia a partir do snapshot completo (preferível à taxonomia oportunista/parcial de
// cacheCatalogTaxonomy). undefined quando não há snapshot completo neste aparelho.
export function readCatalogSnapshotTaxonomy() {
  return attempt(
    'catalog:snapshot-taxonomy',
    () =>
      withTransaction(
        [STORES.exerciseCatalog, STORES.syncMeta],
        'readonly',
        async ({ exerciseCatalog, syncMeta }) => {
          const snapshot = (await request(syncMeta.get(CATALOG_SNAPSHOT_KEY)))?.value
          if (snapshot?.complete !== true) return undefined
          const records = await request(exerciseCatalog.getAll())
          return deriveCatalogTaxonomyFromSnapshot(records)
        }
      ),
    undefined
  )
}

// Mesma semântica da RPC search_exercise_catalog, MENOS a busca aproximada por trigrama
// (aqui é "o nome contém o termo", sem acento/caixa). Ordena por nome. Com snapshot COMPLETO
// (complete=true), zero resultado é uma resposta válida (`total: 0`) -- a busca percorreu
// TODOS os exercícios ativos e nenhum bateu com o filtro. Sem snapshot completo, mantém o
// comportamento anterior: zero resultado devolve undefined (cache parcial não pode fingir que
// "não existe" quando só significa "ainda não vi esse exercício").
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
      const { records, snapshot } = await withTransaction(
        [STORES.exerciseCatalog, STORES.syncMeta],
        'readonly',
        async ({ exerciseCatalog, syncMeta }) => ({
          records: await request(exerciseCatalog.getAll()),
          snapshot: (await request(syncMeta.get(CATALOG_SNAPSHOT_KEY)))?.value,
        })
      )
      const complete = snapshot?.complete === true
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
      if (matches.length === 0 && !complete) return undefined
      matches.sort((a, b) => a.nameKey.localeCompare(b.nameKey) || a.name.localeCompare(b.name))
      const size = Math.min(Math.max(Number(limit) || 1, 1), MAX_SEARCH_LIMIT)
      const start = Math.max(Number(offset) || 0, 0)
      return {
        data: matches.slice(start, start + size).map(toExercise),
        total: matches.length,
        complete,
      }
    },
    undefined
  )
}

// Mesma regra do servidor: catalogId (PK) ou provider + providerExerciseId. undefined = não está
// no cache (NÃO significa que não existe no catálogo). O shape do exercício devolvido não muda
// (para não afetar nenhum componente que já consome `data`) -- quem precisa saber se o cache está
// completo usa isCatalogSnapshotComplete() à parte.
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

// Helper leve para a UI (ex.: useExerciseCatalogDetail) decidir a mensagem certa quando o detalhe
// vem do cache: "disponível offline" (snapshot completo) vs "apenas o que foi salvo antes".
export async function isCatalogSnapshotComplete() {
  const snapshot = await readCatalogSnapshotMeta()
  return snapshot?.complete === true
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
