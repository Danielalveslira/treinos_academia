import { attempt, iterate, request, withTransaction } from './database.js'
import { STORES, userMetaKey } from './schema.js'
import { OPERATIONS, pendingEntityIds } from './outbox.js'
import { businessDayKeyDaysAgo } from '../../utils/businessDate.js'

// Cache LOCAL do histórico RECENTE de public.workouts (uma linha por exercício por dia; séries em
// set_details jsonb; dia em `date`). Dado PRIVADO: chave primária [user_id, id], toda leitura e
// escrita filtradas por user_id. Guarda a linha exatamente como o servidor devolve (snake_case) e
// quem lê reaplica o mesmo mapeamento do serviço -- sem um segundo "modelo" para manter.
//
// Retenção (recente, não "tudo"): no máximo MAX_ROWS_PER_USER linhas e nada mais velho que
// MAX_AGE_DAYS. Alinhado ao Dashboard (371 dias / 500 linhas).
//
// Consistência com o servidor: cada página lida do servidor (a) faz upsert das linhas e (b)
// RECONCILIA o intervalo que ela cobre -- linha em cache, dentro do intervalo e dos filtros, que
// o servidor não devolveu mais, foi apagada lá e sai daqui (ver recordWorkoutsPage).
// Toda função pública NUNCA lança.

export const MAX_ROWS_PER_USER = 500
export const MAX_AGE_DAYS = 400
const SYNCED_AT = 'workouts:syncedAt'
const KEY_MIN = ''
const KEY_MAX = '￿'

// Mesma ordem do servidor: date desc, created_at desc (strings ISO: a ordem lexicográfica é a
// cronológica). cursor/limite do serviço seguem keyset estrito: key < cursor.
function compareDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
  return 0
}

function matchesFilters(row, { exerciseId, startDate, endDate } = {}) {
  return (
    (!exerciseId || row.exercise_id === exerciseId) &&
    (!startDate || row.date >= startDate) &&
    (!endDate || row.date <= endDate)
  )
}

function validRow(userId, row) {
  return Boolean(
    row &&
    typeof row.id === 'string' &&
    row.id &&
    row.user_id === userId &&
    typeof row.date === 'string' &&
    typeof row.created_at === 'string'
  )
}

function cutoffDate(now) {
  return businessDayKeyDaysAgo(MAX_AGE_DAYS, now) // calendário do negócio (America/Sao_Paulo)
}

const byUserDateRange = (userId, lower, upper, lowerOpen = false, upperOpen = false) =>
  IDBKeyRange.bound(
    [userId, lower?.date ?? KEY_MIN, lower?.created_at ?? KEY_MIN],
    [userId, upper?.date ?? KEY_MAX, upper?.created_at ?? KEY_MAX],
    lowerOpen,
    upperOpen
  )

// Aplica upsert + reconciliação + poda NA MESMA transação (nunca fica no meio).
//  rows    -> linhas devolvidas pelo servidor, na ordem dele (date desc, created_at desc)
//  filters -> { exerciseId, startDate, endDate } usados na consulta
//  cursor  -> { date, createdAt } (exclusivo) da página, ou null na primeira
//  limit   -> tamanho pedido; página cheia (rows.length >= limit) => pode haver mais antigas
export function recordWorkoutsPage(
  userId,
  rows,
  { filters = {}, cursor = null, limit = Infinity, now = Date.now() } = {}
) {
  if (!userId || !Array.isArray(rows)) return Promise.resolve(false)
  return attempt(
    'history:write',
    async () => {
      const valid = rows.filter((row) => validRow(userId, row))
      const returnedIds = new Set(valid.map((row) => row.id))
      const full = rows.length >= limit
      const last = valid.length ? valid[valid.length - 1] : null
      await withTransaction(
        [STORES.workouts, STORES.syncMeta, STORES.outbox],
        'readwrite',
        async ({ workouts, syncMeta, outbox }) => {
          // Registros com mutação pendente são do usuário e o servidor ainda não os conhece (ou os
          // conhece defasados): leituras do servidor nunca os sobrescrevem, apagam nem podam.
          const pending = await pendingEntityIds(outbox, userId)
          const index = workouts.index('byUserDate')
          // Reconciliação: só o trecho que a página de fato cobre. Página cheia => do último item
          // (exclusivo) até o cursor; página incompleta => tudo abaixo do cursor.
          const lower = full && last ? last : null
          const upper = cursor ? { date: cursor.date, created_at: cursor.createdAt } : null
          const range = byUserDateRange(userId, lower, upper, Boolean(lower), Boolean(upper))
          await iterate(index, range, 'next', (cursorRow) => {
            const row = cursorRow.value
            if (!returnedIds.has(row.id) && !pending.has(row.id) && matchesFilters(row, filters)) {
              cursorRow.delete()
            }
          })
          for (const row of valid) if (!pending.has(row.id)) workouts.put(row)
          await prune(workouts, userId, now, pending)
          syncMeta.put({ key: userMetaKey(userId, SYNCED_AT), value: now })
        }
      )
      return true
    },
    false
  )
}

async function prune(workouts, userId, now, pending = new Set()) {
  const index = workouts.index('byUserDate')
  // Velhas demais.
  await iterate(
    index,
    byUserDateRange(userId, null, { date: cutoffDate(now), created_at: KEY_MIN }, false, true),
    'next',
    (c) => {
      if (!pending.has(c.value.id)) c.delete()
    }
  )
  // Excesso: remove as mais antigas até sobrar MAX_ROWS_PER_USER.
  let excess = (await request(workouts.index('byUser').count(userId))) - MAX_ROWS_PER_USER
  if (excess <= 0) return
  await iterate(index, byUserDateRange(userId), 'next', (c) => {
    if (pending.has(c.value.id)) return true
    c.delete()
    excess -= 1
    return excess > 0
  })
}

// Após create/update bem-sucedidos online: guarda a linha que o servidor devolveu.
export function cacheWorkoutRow(userId, row, now = Date.now()) {
  if (!validRow(userId, row)) return Promise.resolve(false)
  return attempt(
    'history:row-write',
    async () => {
      await withTransaction(
        [STORES.workouts, STORES.outbox],
        'readwrite',
        async ({ workouts, outbox }) => {
          const pending = await pendingEntityIds(outbox, userId)
          // Resposta do servidor a uma gravação ONLINE: é a verdade, exceto se ainda há mutação local
          // pendente para o mesmo registro (então o estado local desejado prevalece até o ACK).
          if (!pending.has(row.id)) workouts.put(row)
          await prune(workouts, userId, now, pending)
        }
      )
      return true
    },
    false
  )
}

// Após delete bem-sucedido online.
export function forgetCachedWorkout(userId, workoutId) {
  if (!userId || !workoutId) return Promise.resolve(false)
  return attempt(
    'history:row-delete',
    async () => {
      await withTransaction([STORES.workouts], 'readwrite', ({ workouts }) =>
        request(workouts.delete([userId, workoutId]))
      )
      return true
    },
    false
  )
}

// Leitura local com a mesma paginação keyset do serviço. undefined = este usuário nunca teve o
// histórico confirmado pelo servidor neste aparelho (nada confiável). Devolve as linhas (já na
// ordem do servidor) e `nextCursor` quando ainda há linhas locais mais antigas.
export function readCachedWorkouts(userId, { filters = {}, cursor = null, limit = 20 } = {}) {
  if (!userId) return Promise.resolve(undefined)
  return attempt(
    'history:read',
    () =>
      withTransaction(
        [STORES.workouts, STORES.syncMeta, STORES.outbox],
        'readonly',
        async ({ workouts, syncMeta, outbox }) => {
          const synced = await request(syncMeta.get(userMetaKey(userId, SYNCED_AT)))
          // Sem histórico confirmado pelo servidor neste aparelho (nunca lido, ou a marca saiu numa
          // limpeza de cache) não há "histórico" confiável para mostrar -- MAS o que o usuário salvou e a
          // outbox ainda carrega é trabalho dele e continua legível (senão sumiria da tela offline).
          const pending = synced ? null : await pendingEntityIds(outbox, userId)
          if (!synced && pending.size === 0) return undefined
          const upper = cursor ? { date: cursor.date, created_at: cursor.createdAt } : null
          const range = byUserDateRange(userId, null, upper, false, Boolean(upper))
          const rows = []
          let hasMore = false
          await iterate(workouts.index('byUserDate'), range, 'prev', (c) => {
            if (pending && !pending.has(c.value.id)) return true
            if (!matchesFilters(c.value, filters)) return true
            if (rows.length === limit) {
              hasMore = true
              return false
            }
            rows.push(c.value)
            return true
          })
          rows.sort(compareDesc)
          const last = rows[rows.length - 1]
          return {
            rows,
            nextCursor: hasMore && last ? { date: last.date, createdAt: last.created_at } : null,
          }
        }
      ),
    undefined
  )
}

// Linha local do registro (estado desejado pelo usuário, inclusive alterações ainda não sincronizadas).
// Serve para saber a versão-base (updated_at) de uma edição. undefined = não está no aparelho.
export function readCachedWorkoutRow(userId, workoutId) {
  if (!userId || !workoutId) return Promise.resolve(undefined)
  return attempt(
    'history:row-read',
    () =>
      withTransaction([STORES.workouts], 'readonly', ({ workouts }) =>
        request(workouts.get([userId, workoutId]))
      ),
    undefined
  )
}

// Visão que o usuário deve ver = snapshot do servidor + mutações locais ainda pendentes. Sem isto, uma
// leitura do servidor "apagaria" da tela o que foi salvo offline e ainda não sincronizou (e traria de
// volta o que foi apagado offline). Cobre só o TRECHO que a página lê: pendências mais antigas que o
// fim de uma página cheia pertencem às próximas páginas. Sem pendências (o normal) devolve `rows` como
// veio.
export async function overlayPendingWorkouts(
  userId,
  rows,
  { filters = {}, cursor = null, limit = Infinity } = {}
) {
  if (!userId) return rows
  return attempt(
    'history:overlay',
    () =>
      withTransaction(
        [STORES.outbox, STORES.workouts],
        'readonly',
        async ({ outbox, workouts }) => {
          const mutations = await request(
            outbox
              .index('byUserSeq')
              .getAll(IDBKeyRange.bound([userId, 0], [userId, Number.MAX_SAFE_INTEGER]))
          )
          if (mutations.length === 0) return rows
          const deleted = new Set()
          const touched = new Set()
          for (const mutation of mutations) {
            if (mutation.operation === OPERATIONS.delete) {
              deleted.add(mutation.entity_id)
              touched.delete(mutation.entity_id)
            } else {
              touched.add(mutation.entity_id)
              deleted.delete(mutation.entity_id)
            }
          }
          const byId = new Map(
            rows.filter((row) => !deleted.has(row.id)).map((row) => [row.id, row])
          )
          const full = rows.length >= limit
          const lastServer = rows.length ? rows[rows.length - 1] : null
          const keyOf = (row) => [row.date, row.created_at]
          const above = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1])
          for (const id of touched) {
            const local = await request(workouts.get([userId, id]))
            if (!local || !matchesFilters(local, filters)) {
              // Editado para fora dos filtros: some desta consulta.
              if (local) byId.delete(id)
              continue
            }
            if (cursor && !above([cursor.date, cursor.createdAt], keyOf(local))) continue
            if (full && lastServer && !above(keyOf(local), keyOf(lastServer)) && !byId.has(id))
              continue
            byId.set(id, local)
          }
          return [...byId.values()].sort(compareDesc)
        }
      ),
    rows
  )
}
