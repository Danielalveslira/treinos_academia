import { attempt, request, withTransaction } from './database.js'
import { STORES, userMetaKey } from './schema.js'

// Cache LOCAL dos exercícios PESSOAIS do usuário (public.exercises) -- dado PRIVADO: toda linha
// tem user_id na chave primária e toda leitura filtra por ele. O histórico (workouts) só faz
// sentido com os nomes/grupos destes exercícios, por isso andam juntos.
//
// A lista é pequena (teto de 300 no serviço) e o servidor devolve TODOS, então cada resposta
// SUBSTITUI a lista do usuário (o que foi apagado no servidor sai daqui).
// Toda função pública NUNCA lança.

const SYNCED_AT = 'exercises:syncedAt'

function validRow(userId, row) {
  return Boolean(row && typeof row.id === 'string' && row.id && row.user_id === userId)
}

export function replaceCachedUserExercises(userId, rows, now = Date.now()) {
  if (!userId || !Array.isArray(rows)) return Promise.resolve(false)
  return attempt(
    'exercises:write',
    async () => {
      const keep = rows.filter((row) => validRow(userId, row))
      const keepIds = new Set(keep.map((row) => row.id))
      await withTransaction(
        [STORES.userExercises, STORES.syncMeta],
        'readwrite',
        async ({ userExercises, syncMeta }) => {
          const existing = await request(userExercises.index('byUser').getAllKeys(userId))
          for (const key of existing) if (!keepIds.has(key[1])) userExercises.delete(key)
          for (const row of keep) userExercises.put(row)
          syncMeta.put({ key: userMetaKey(userId, SYNCED_AT), value: now })
        }
      )
      return true
    },
    false
  )
}

// undefined = este usuário nunca teve a lista confirmada pelo servidor neste aparelho (nada
// confiável para mostrar). Lista vazia COM confirmação é uma resposta válida.
export function readCachedUserExercises(userId) {
  if (!userId) return Promise.resolve(undefined)
  return attempt(
    'exercises:read',
    () =>
      withTransaction(
        [STORES.userExercises, STORES.syncMeta],
        'readonly',
        async ({ userExercises, syncMeta }) => {
          const synced = await request(syncMeta.get(userMetaKey(userId, SYNCED_AT)))
          if (!synced) return undefined
          return request(userExercises.index('byUser').getAll(userId))
        }
      ),
    undefined
  )
}

// ---- Gravações ONLINE de exercícios pessoais (o servidor já confirmou) ----------------------------------------
// Mantêm a cópia local coerente sem esperar a próxima leitura da lista. Não confirmam a lista inteira
// (não mexem em syncedAt), nunca lançam e só afetam o usuário informado. Exercícios pessoais NÃO têm
// escrita offline nesta fase.

export function upsertCachedUserExercise(userId, row) {
  if (!validRow(userId, row)) return Promise.resolve(false)
  return attempt(
    'exercises:row-write',
    async () => {
      await withTransaction([STORES.userExercises], 'readwrite', ({ userExercises }) =>
        request(userExercises.put(row))
      )
      return true
    },
    false
  )
}

export function patchCachedUserExercise(userId, exerciseId, patch) {
  if (!userId || !exerciseId || !patch) return Promise.resolve(false)
  return attempt(
    'exercises:row-patch',
    () =>
      withTransaction([STORES.userExercises], 'readwrite', async ({ userExercises }) => {
        const current = await request(userExercises.get([userId, exerciseId]))
        if (!current) return false // não está no aparelho: a próxima leitura traz a linha inteira
        userExercises.put({ ...current, ...patch, user_id: userId, id: exerciseId })
        return true
      }),
    false
  )
}

export function removeCachedUserExercise(userId, exerciseId) {
  if (!userId || !exerciseId) return Promise.resolve(false)
  return attempt(
    'exercises:row-delete',
    async () => {
      await withTransaction([STORES.userExercises], 'readwrite', ({ userExercises }) =>
        request(userExercises.delete([userId, exerciseId]))
      )
      return true
    },
    false
  )
}

// Mesma regra de save_exercise_order: a posição de cada exercício é o índice na lista enviada.
export function setCachedUserExerciseOrder(userId, orderedIds) {
  if (!userId || !Array.isArray(orderedIds)) return Promise.resolve(false)
  return attempt(
    'exercises:order',
    () =>
      withTransaction([STORES.userExercises], 'readwrite', async ({ userExercises }) => {
        for (const [index, id] of orderedIds.entries()) {
          const current = await request(userExercises.get([userId, id]))
          if (current) userExercises.put({ ...current, order: index })
        }
        return true
      }),
    false
  )
}
