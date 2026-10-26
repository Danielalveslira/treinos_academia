import { attempt, iterate, request, withTransaction } from './database.js'
import { STORES } from './schema.js'

// Outbox: mutações de treino feitas OFFLINE (ou com a rede falhando) que ainda não foram confirmadas
// pelo servidor. É TRABALHO DO USUÁRIO, não cache: nunca é apagada por logout, troca de conta,
// expiração de sessão ou limpeza de armazenamento -- só sai daqui quando o servidor confirma (ACK) ou
// quando o próprio usuário descarta (discardMutation).
//
// Modelo real de treino: public.workouts, UMA linha por exercício por dia (set_details jsonb, date).
// Operações previstas (lista fechada, igual à do servidor): workout.create | workout.update | workout.delete.
// O payload de create/update é sempre o ESTADO COMPLETO dos campos editáveis (não um diff), o que torna
// a compactação trivial e o reenvio idempotente.
//
// O registro local (store `workouts`) e a mutação são gravados na MESMA transação: nunca existe dado
// local alterado sem a mutação correspondente (nem o contrário).

export const OPERATIONS = Object.freeze({
  create: 'workout.create',
  update: 'workout.update',
  delete: 'workout.delete',
})

export const STATUS = Object.freeze({ pending: 'pending', syncing: 'syncing', failed: 'failed' })

// Depois de tantas tentativas transitórias seguidas a mutação vira `failed` (RETRY_LIMIT): deixa de
// tentar sozinha, mas continua aqui; "Sincronizar agora"/"Tentar de novo" a recoloca na fila.
export const isPermanentExerciseFailure = (mutation) =>
  ['CUSTOM_EXERCISES_DISABLED', 'LEGACY_EXERCISE_READ_ONLY'].includes(mutation.last_error?.code)

export const MAX_ATTEMPTS = 10
const BACKOFF_SECONDS = [2, 5, 15, 30, 60, 120, 300]

// Backoff exponencial com jitter (±20%). `random` injetável para teste.
export function backoffDelayMs(attempts, random = Math.random) {
  const base = BACKOFF_SECONDS[Math.min(Math.max(attempts, 1), BACKOFF_SECONDS.length) - 1] * 1000
  return Math.round(base * (0.8 + random() * 0.4))
}

const userRange = (userId) => IDBKeyRange.bound([userId, 0], [userId, Number.MAX_SAFE_INTEGER])
const iso = (ms) => new Date(ms).toISOString()

async function mutationsOf(outbox, userId) {
  return request(outbox.index('byUserSeq').getAll(userRange(userId)))
}

// Ids de entidades com mutação pendente do usuário (protege as linhas locais de serem sobrescritas,
// reconciliadas ou podadas por leituras do servidor enquanto o servidor ainda não as conhece).
export async function pendingEntityIds(outboxStore, userId) {
  const all = await mutationsOf(outboxStore, userId)
  return new Set(all.map((mutation) => mutation.entity_id))
}

export function buildLocalRow(userId, entityId, payload, existing, now) {
  const strength = payload.type === 'strength'
  return {
    user_id: userId,
    id: entityId,
    exercise_id: payload.exercise_id,
    // Existing server attribution survives local edits; never accept a new link from payload.
    ...(existing?.sheet_id ? { sheet_id: existing.sheet_id } : {}),
    date: payload.date,
    type: payload.type,
    set_details: strength ? payload.set_details : null,
    sets: strength ? payload.set_details.length : null,
    duration_minutes: strength ? null : payload.duration_minutes,
    distance_km: strength ? null : (payload.distance_km ?? null),
    note: payload.note ?? '',
    // created_at/updated_at locais são só apresentação até o ACK: o servidor carimba os dele.
    created_at: existing?.created_at ?? iso(now),
    updated_at: existing?.updated_at ?? null,
  }
}

function newMutation({
  userId,
  seq,
  operation,
  entityId,
  payload,
  baseUpdatedAt,
  now,
  dates = [],
}) {
  return {
    mutation_id: globalThis.crypto.randomUUID(),
    user_id: userId,
    seq,
    entity_type: 'workout',
    entity_id: entityId,
    operation,
    payload: payload ?? null,
    // Dias (YYYY-MM-DD) que esta mutação toca: o do payload e o do registro local antes da mudança
    // (uma edição que move o treino de dia toca os dois). Serve para saber se ela é relevante para o
    // treino de um dia (ver isRelevantToDate) sem abrir o payload nem depender de a linha existir.
    dates,
    base_updated_at: baseUpdatedAt ?? null,
    created_at: iso(now),
    updated_at: iso(now),
    attempts: 0,
    last_attempt_at: null,
    next_attempt_at: null,
    last_error: null,
    status: STATUS.pending,
  }
}

async function nextSeq(outbox, userId) {
  let last = 0
  await iterate(outbox.index('byUserSeq'), userRange(userId), 'prev', (cursor) => {
    last = cursor.value.seq
    return false
  })
  return last + 1
}

const unionDates = (...lists) =>
  [...new Set(lists.flat().filter((d) => typeof d === 'string' && d))].sort()

// A mutação afeta o treino do dia `date`? Sem data conhecida (mutação antiga ou delete de um registro que
// não estava no aparelho) a resposta é SIM: na dúvida, trata como relevante e nunca finaliza sem ela.
export function isRelevantToDate(mutation, date) {
  const dates = mutation.dates
  return !Array.isArray(dates) || dates.length === 0 || dates.includes(date)
}

function reset(mutation, now) {
  mutation.status = STATUS.pending
  mutation.attempts = 0
  mutation.next_attempt_at = null
  mutation.last_error = null
  mutation.updated_at = iso(now)
}

// Enfileira UMA mutação e aplica a mudança no registro local, na mesma transação, compactando com o
// que já está pendente para o MESMO registro:
//   create + update(s)            -> um create com o estado final
//   update + update               -> um update com o payload final (mantém a versão-base mais antiga)
//   create + delete               -> nada (o servidor nunca soube do registro): some tudo
//   update + delete               -> um delete (mantém a versão-base)
// Nunca compacta uma mutação `syncing` (pode estar a caminho do servidor): a nova entra DEPOIS dela e é
// rebaseada quando o ACK chegar (ver completeMutation).
// Devolve { mutation_id|null, compacted: null|'merged'|'cancelled'|'replaced'|'noop' }.
export async function enqueueWorkoutMutation(
  userId,
  { operation, entityId, payload, baseUpdatedAt = null, now = Date.now() }
) {
  if (!userId || !entityId)
    throw new Error('enqueueWorkoutMutation: userId e entityId são obrigatórios')
  if (!Object.values(OPERATIONS).includes(operation))
    throw new Error(`Operação não suportada: ${operation}`)
  if (operation !== OPERATIONS.delete && (!payload || typeof payload !== 'object')) {
    throw new Error('enqueueWorkoutMutation: payload obrigatório')
  }
  return withTransaction(
    [STORES.outbox, STORES.workouts],
    'readwrite',
    async ({ outbox, workouts }) => {
      const existing = await request(outbox.index('byUserEntity').getAll([userId, entityId]))
      existing.sort((a, b) => a.seq - b.seq)
      const last = existing[existing.length - 1]
      const localRow = await request(workouts.get([userId, entityId]))
      const open = last && last.status !== STATUS.syncing ? last : null

      if (operation === OPERATIONS.create) {
        if (last) throw new Error('ENTITY_ALREADY_QUEUED')
        const mutation = newMutation({
          userId,
          seq: await nextSeq(outbox, userId),
          operation,
          entityId,
          payload,
          now,
          dates: unionDates([payload.date], [localRow?.date]),
        })
        outbox.put(mutation)
        workouts.put(buildLocalRow(userId, entityId, payload, localRow, now))
        return { mutation_id: mutation.mutation_id, compacted: null }
      }

      if (operation === OPERATIONS.update) {
        if (last?.operation === OPERATIONS.delete) throw new Error('ENTITY_DELETED')
        workouts.put(buildLocalRow(userId, entityId, payload, localRow, now))
        if (open) {
          // create+update vira create com o estado final; update+update vira o último update.
          open.payload = payload
          open.dates = unionDates(open.dates ?? [], [payload.date], [localRow?.date])
          reset(open, now)
          outbox.put(open)
          return { mutation_id: open.mutation_id, compacted: 'merged' }
        }
        const base = baseUpdatedAt ?? (last ? null : (localRow?.updated_at ?? null))
        const mutation = newMutation({
          userId,
          seq: await nextSeq(outbox, userId),
          operation,
          entityId,
          payload,
          baseUpdatedAt: base,
          now,
          dates: unionDates(last?.dates ?? [], [payload.date], [localRow?.date]),
        })
        outbox.put(mutation)
        return { mutation_id: mutation.mutation_id, compacted: null }
      }

      // delete
      if (last?.operation === OPERATIONS.delete)
        return { mutation_id: last.mutation_id, compacted: 'noop' }
      workouts.delete([userId, entityId])
      if (open?.operation === OPERATIONS.create) {
        // O servidor nunca soube deste registro: não há nada a enviar.
        outbox.delete(open.mutation_id)
        return { mutation_id: null, compacted: 'cancelled' }
      }
      if (open?.operation === OPERATIONS.update) {
        open.operation = OPERATIONS.delete
        open.payload = null
        open.dates = unionDates(open.dates ?? [], [localRow?.date])
        reset(open, now)
        outbox.put(open)
        return { mutation_id: open.mutation_id, compacted: 'replaced' }
      }
      const base = baseUpdatedAt ?? (last ? null : (localRow?.updated_at ?? null))
      const mutation = newMutation({
        userId,
        seq: await nextSeq(outbox, userId),
        operation,
        entityId,
        payload: null,
        baseUpdatedAt: base,
        now,
        dates: unionDates(last?.dates ?? [], [localRow?.date]),
      })
      outbox.put(mutation)
      return { mutation_id: mutation.mutation_id, compacted: null }
    }
  )
}

// ---- Leitura (nunca lança: sem banco = sem pendências conhecidas) --------------------------------------

export function listMutations(userId) {
  if (!userId) return Promise.resolve([])
  return attempt(
    'outbox:list',
    () => withTransaction([STORES.outbox], 'readonly', ({ outbox }) => mutationsOf(outbox, userId)),
    []
  )
}

export async function getOutboxSummary(userId, now = Date.now()) {
  const all = await listMutations(userId)
  const summary = {
    total: all.length,
    pending: 0,
    syncing: 0,
    failed: 0,
    oldestPendingAt: null,
    nextAttemptAt: null,
  }
  for (const mutation of all) {
    summary[mutation.status] += 1
    if (mutation.status === STATUS.pending) {
      if (!summary.oldestPendingAt || mutation.created_at < summary.oldestPendingAt)
        summary.oldestPendingAt = mutation.created_at
      if (mutation.next_attempt_at && mutation.next_attempt_at > now) {
        summary.nextAttemptAt = summary.nextAttemptAt
          ? Math.min(summary.nextAttemptAt, mutation.next_attempt_at)
          : mutation.next_attempt_at
      }
    }
  }
  return summary
}

export function hasPendingMutation(userId, entityId) {
  if (!userId || !entityId) return Promise.resolve(false)
  return attempt(
    'outbox:has',
    () =>
      withTransaction(
        [STORES.outbox],
        'readonly',
        async ({ outbox }) =>
          (await request(outbox.index('byUserEntity').count([userId, entityId]))) > 0
      ),
    false
  )
}

// ---- Engine: claim / ACK / falha ----------------------------------------------------------------------------

// Com o lock de sync em mãos ninguém mais pode estar enviando: qualquer `syncing` é resto de uma aba
// fechada, de um reload (atualização da PWA) ou de um crash no meio do envio. Volta para a fila sem
// ficar "eterno" em syncing. A tentativa CONTA (o envio de fato começou): uma mutação que derruba a aba
// toda vez que é enviada chega ao limite e para, em vez de girar para sempre; a partir da 2ª tentativa
// aplica o mesmo backoff das falhas. Se o servidor chegou a aplicar, o reenvio é resolvido pelo recibo.
export function recoverStaleSyncing(userId, now = Date.now(), random = Math.random) {
  return withTransaction([STORES.outbox], 'readwrite', async ({ outbox }) => {
    let recovered = 0
    for (const mutation of await mutationsOf(outbox, userId)) {
      if (mutation.status !== STATUS.syncing) continue
      mutation.updated_at = iso(now)
      if (mutation.attempts >= MAX_ATTEMPTS) {
        mutation.status = STATUS.failed
        mutation.next_attempt_at = null
        mutation.last_error = { code: 'RETRY_LIMIT', at: iso(now), server_row: null }
      } else {
        mutation.status = STATUS.pending
        mutation.next_attempt_at =
          mutation.attempts > 1 ? now + backoffDelayMs(mutation.attempts, random) : null
      }
      outbox.put(mutation)
      recovered += 1
    }
    return recovered
  })
}

// Próximo lote, em ordem de seq. Uma mutação NÃO sai antes de outra mais antiga do MESMO registro (que
// esteja em andamento, falha ou em espera de backoff). Marca o lote como `syncing` e conta a tentativa.
export function claimNextBatch(
  userId,
  { limit = 25, force = false, now = Date.now(), filter = null } = {}
) {
  return withTransaction([STORES.outbox], 'readwrite', async ({ outbox }) => {
    const blocked = new Set()
    const batch = []
    for (const mutation of await mutationsOf(outbox, userId)) {
      const waiting = !force && mutation.next_attempt_at && mutation.next_attempt_at > now
      // `filter` limita o lote a um subconjunto (ex.: o treino de hoje antes de finalizar). Fora do filtro
      // a mutação fica como está e, como qualquer inelegível, segura as seguintes do MESMO registro.
      const eligible =
        mutation.status === STATUS.pending &&
        (!filter || filter(mutation)) &&
        !waiting &&
        !blocked.has(mutation.entity_id) &&
        batch.length < limit
      if (!eligible) {
        blocked.add(mutation.entity_id)
        continue
      }
      mutation.status = STATUS.syncing
      mutation.attempts += 1
      mutation.last_attempt_at = iso(now)
      mutation.updated_at = iso(now)
      outbox.put(mutation)
      batch.push(mutation)
    }
    return batch
  })
}

// ACK do servidor (applied | already_applied): remove a mutação, atualiza o registro local com a linha
// oficial e rebaseia as mutações seguintes do mesmo registro na nova versão do servidor.
export function completeMutation(userId, mutation, result, now = Date.now()) {
  return withTransaction(
    [STORES.outbox, STORES.workouts],
    'readwrite',
    async ({ outbox, workouts }) => {
      outbox.delete(mutation.mutation_id)
      const serverUpdatedAt = result?.server_updated_at ?? result?.row?.updated_at ?? null
      const later = (
        await request(outbox.index('byUserEntity').getAll([userId, mutation.entity_id]))
      ).filter((m) => m.seq > mutation.seq)
      for (const next of later) {
        if (next.operation !== OPERATIONS.create && serverUpdatedAt)
          next.base_updated_at = serverUpdatedAt
        next.updated_at = iso(now)
        outbox.put(next)
      }
      if (mutation.operation === OPERATIONS.delete) return
      const row = result?.row
      if (row && row.user_id === userId) {
        if (later.length === 0) workouts.put(row)
        else {
          const local = await request(workouts.get([userId, mutation.entity_id]))
          if (local)
            workouts.put({
              ...local,
              created_at: row.created_at,
              updated_at: serverUpdatedAt ?? local.updated_at,
            })
        }
      }
    }
  )
}

// Falha NÃO transitória (validação, conflito, permissão): fica aqui, marcada, com os dados locais
// intactos, esperando decisão. Para CONFLICT/NOT_FOUND guarda a linha do servidor para a decisão.
export function failMutation(
  userId,
  mutationId,
  { code, serverRow = null } = {},
  now = Date.now()
) {
  return withTransaction([STORES.outbox], 'readwrite', async ({ outbox }) => {
    const mutation = await request(outbox.get(mutationId))
    if (!mutation || mutation.user_id !== userId) return false
    mutation.status = STATUS.failed
    mutation.next_attempt_at = null
    mutation.last_error = { code: code || 'UNKNOWN', at: iso(now), server_row: serverRow }
    mutation.updated_at = iso(now)
    outbox.put(mutation)
    return true
  })
}

// Devolve mutações à fila. `countAttempt:false` (auth, troca de usuário, dependência) não gasta tentativa.
// Falha transitória aplica backoff; passou de MAX_ATTEMPTS vira failed/RETRY_LIMIT.
export function releaseMutations(
  userId,
  mutationIds,
  { countAttempt = true, code = null, now = Date.now(), random = Math.random } = {}
) {
  return withTransaction([STORES.outbox], 'readwrite', async ({ outbox }) => {
    const states = []
    for (const id of mutationIds) {
      const mutation = await request(outbox.get(id))
      if (!mutation || mutation.user_id !== userId || mutation.status !== STATUS.syncing) continue
      if (!countAttempt) mutation.attempts = Math.max(0, mutation.attempts - 1)
      mutation.updated_at = iso(now)
      if (countAttempt && mutation.attempts >= MAX_ATTEMPTS) {
        mutation.status = STATUS.failed
        mutation.next_attempt_at = null
        mutation.last_error = { code: 'RETRY_LIMIT', at: iso(now), server_row: null }
      } else {
        mutation.status = STATUS.pending
        mutation.next_attempt_at = countAttempt
          ? now + backoffDelayMs(mutation.attempts, random)
          : null
        if (code) mutation.last_error = { code, at: iso(now), server_row: null }
      }
      outbox.put(mutation)
      states.push(mutation.status)
    }
    return states
  })
}

// ---- Resolução explícita (ação do usuário) ----------------------------------------------------------------

// "Tentar de novo" / "Sincronizar agora": falhas voltam à fila (zera tentativas e espera).
export function retryFailed(userId, { now = Date.now() } = {}) {
  return withTransaction([STORES.outbox], 'readwrite', async ({ outbox }) => {
    let count = 0
    for (const mutation of await mutationsOf(outbox, userId)) {
      if (mutation.status !== STATUS.failed || isPermanentExerciseFailure(mutation)) continue
      reset(mutation, now)
      outbox.put(mutation)
      count += 1
    }
    return count
  })
}

// "Manter o meu": reenvia a mudança local usando a versão ATUAL do servidor como base (o usuário viu o
// conflito e decidiu sobrescrever).
export function keepLocalAfterConflict(userId, mutationId, { now = Date.now() } = {}) {
  return withTransaction([STORES.outbox], 'readwrite', async ({ outbox }) => {
    const mutation = await request(outbox.get(mutationId))
    if (!mutation || mutation.user_id !== userId || mutation.status !== STATUS.failed) return false
    const serverRow = mutation.last_error?.server_row
    if (serverRow?.updated_at) mutation.base_updated_at = serverRow.updated_at
    reset(mutation, now)
    outbox.put(mutation)
    return true
  })
}

// "Descartar": o usuário abre mão da mudança local. Se o servidor mandou a versão dele, ela volta a ser
// a local; registro criado só aqui (nunca chegou ao servidor) ou apagado lá deixa de existir.
export function discardMutation(userId, mutationId) {
  return withTransaction(
    [STORES.outbox, STORES.workouts],
    'readwrite',
    async ({ outbox, workouts }) => {
      const mutation = await request(outbox.get(mutationId))
      if (!mutation || mutation.user_id !== userId) return false
      outbox.delete(mutation.mutation_id)
      const serverRow = mutation.last_error?.server_row
      if (serverRow && serverRow.user_id === userId) workouts.put(serverRow)
      else if (
        mutation.operation === OPERATIONS.create ||
        mutation.last_error?.code === 'NOT_FOUND'
      ) {
        workouts.delete([userId, mutation.entity_id])
      }
      return true
    }
  )
}
