// Só para testes: um "servidor" em memória com a MESMA semântica da RPC sync_workout_mutations
// (recibo por mutation_id, ownership por usuário da sessão, conflito por versão-base, dependência
// dentro do lote) e utilitários para derrubar a rede em pontos exatos do envio.
const CONTENT_FIELDS = [
  'exercise_id',
  'date',
  'type',
  'set_details',
  'duration_minutes',
  'distance_km',
]
export function sameContent(row, payload) {
  return (
    CONTENT_FIELDS.every(
      (field) => JSON.stringify(row[field] ?? null) === JSON.stringify(payload[field] ?? null)
    ) && (row.note ?? '') === (payload.note ?? '')
  )
}

export function makeServer() {
  const rows = new Map() // `${uid}|${id}` -> linha
  const receipts = new Map() // `${uid}|${mid}` -> { operation, entity_id, server_updated_at }
  const sheets = new Set() // ids de ficha que existem (simula a membership check do INSERT real)
  let clock = 0
  const stamp = () => `2026-10-05T13:00:${String(++clock).padStart(2, '0')}.000000+00:00`
  const server = {
    rows,
    receipts,
    sheets,
    batches: [],
    stamp,
    seed(row) {
      rows.set(`${row.user_id}|${row.id}`, { ...row })
    },
    seedSheet(id) {
      sheets.add(id)
    },
    rowsOf: (uid) => [...rows.values()].filter((r) => r.user_id === uid),
    apply(uid, wire) {
      server.batches.push(wire.map((w) => ({ ...w })))
      const failed = new Set()
      const results = wire.map((item, index) => {
        let result
        if (failed.has(item.entity_id)) {
          result = { status: 'rejected', code: 'DEPENDENCY_FAILED' }
        } else result = applyOne(uid, item)
        if (
          (result.status === 'rejected' || result.status === 'conflict') &&
          result.code !== 'DEPENDENCY_FAILED'
        ) {
          failed.add(item.entity_id)
        }
        return { index, mutation_id: item.mutation_id, entity_id: item.entity_id, ...result }
      })
      return { results }
    },
  }
  function applyOne(uid, item) {
    const key = `${uid}|${item.entity_id}`
    const receipt = receipts.get(`${uid}|${item.mutation_id}`)
    if (receipt) {
      const row = rows.get(key)
      return {
        status: 'already_applied',
        server_updated_at: row?.updated_at ?? receipt.server_updated_at,
        row: row ? { ...row } : undefined,
      }
    }
    const payload = item.payload
    if (item.operation !== 'workout.delete' && payload?.set_details?.some?.((s) => s.weight < 0)) {
      return { status: 'rejected', code: 'INVALID_PAYLOAD' }
    }
    const row = rows.get(key)
    const receipt_ = (outcome, at) =>
      receipts.set(`${uid}|${item.mutation_id}`, {
        operation: item.operation,
        entity_id: item.entity_id,
        outcome,
        server_updated_at: at,
      })
    if (item.operation === 'workout.create') {
      // Mesma semântica do trigger real: só valida a ficha no INSERT de fato, nunca num reenvio
      // idempotente de uma linha que já existe.
      if (!row && payload?.sheet_id && !sheets.has(payload.sheet_id)) {
        return { status: 'rejected', code: 'SHEET_NOT_FOUND' }
      }
      if (row) {
        // Mesma política da RPC: a linha já existe (INSERT online confirmado, resposta perdida), sem recibo.
        if (sameContent(row, payload)) {
          receipt_('already_applied', row.updated_at)
          return { status: 'already_applied', server_updated_at: row.updated_at, row: { ...row } }
        }
        if (row.updated_at !== (item.base_updated_at ?? row.created_at)) {
          return { status: 'conflict', code: 'CONFLICT', server_row: { ...row } }
        }
        const at = stamp()
        const updated = {
          ...row,
          ...payload,
          sets: payload.set_details?.length ?? null,
          updated_at: at,
        }
        rows.set(key, updated)
        receipt_('applied', at)
        return { status: 'applied', server_updated_at: at, row: { ...updated } }
      }
      const at = stamp()
      const created = {
        user_id: uid,
        id: item.entity_id,
        ...payload,
        sets: payload.set_details?.length ?? null,
        created_at: at,
        updated_at: at,
      }
      rows.set(key, created)
      receipt_('applied', at)
      return { status: 'applied', server_updated_at: at, row: { ...created } }
    }
    if (!row) {
      if (item.operation === 'workout.delete') {
        receipt_('already_applied')
        return { status: 'already_applied' }
      }
      return { status: 'rejected', code: 'NOT_FOUND' }
    }
    if (row.updated_at !== (item.base_updated_at ?? row.created_at)) {
      const same =
        item.operation === 'workout.update' &&
        JSON.stringify(row.set_details) === JSON.stringify(payload.set_details)
      if (same) {
        receipt_('already_applied', row.updated_at)
        return { status: 'already_applied', server_updated_at: row.updated_at, row: { ...row } }
      }
      return { status: 'conflict', code: 'CONFLICT', server_row: { ...row } }
    }
    if (item.operation === 'workout.delete') {
      rows.delete(key)
      receipt_('applied')
      return { status: 'applied' }
    }
    const at = stamp()
    const updated = {
      ...row,
      ...payload,
      sets: payload.set_details?.length ?? null,
      updated_at: at,
    }
    rows.set(key, updated)
    receipt_('applied', at)
    return { status: 'applied', server_updated_at: at, row: { ...updated } }
  }
  return server
}

// Dependências do engine ligadas ao servidor falso. `behavior` controla a rede em cada chamada:
//   before(call)  -> lança ANTES de o servidor aplicar (requisição não chegou)
//   after(call)   -> lança DEPOIS de o servidor aplicar (ACK perdido)
export function makeDeps({ server, getUser = () => 'user-a', behavior = {}, extra = {} } = {}) {
  let calls = 0
  const events = []
  const deps = {
    getSession: async () => ({ userId: getUser() }),
    rpc: async (wire, expectedUser, signal) => {
      calls += 1
      await behavior.before?.(calls, signal)
      const sessionUser = getUser()
      if (expectedUser && sessionUser !== expectedUser) throw { message: 'USER_MISMATCH' }
      const response = server.apply(sessionUser, wire)
      await behavior.after?.(calls, response)
      return response
    },
    probe: async () => behavior.reachable?.() ?? true,
    withLock: async (userId, work) => ({ acquired: true, value: await work() }),
    channel: { post: (type, userId) => events.push({ type, userId }) },
    now: () => Date.UTC(2026, 9, 5, 12),
    random: () => 0.5,
    ...extra,
  }
  return Object.defineProperties(deps, {
    calls: { get: () => calls },
    events: { value: events },
  })
}

export const NETWORK_ERROR = () => ({
  message: 'TypeError: Failed to fetch',
  code: '',
  details: '',
  hint: '',
})
