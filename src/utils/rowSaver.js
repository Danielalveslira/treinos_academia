import { setValueKey } from './setSession.js'

// Grava UM registro (a linha do exercício no dia) de forma serializada: no máximo uma gravação em voo, e
// enquanto ela corre só o estado MAIS RECENTE pedido fica na espera (cada payload leva todas as séries
// concluídas, então o último sempre contém os anteriores). Isso evita corridas entre toques rápidos
// (create duplicado, update antigo sobrescrevendo um novo) sem fila crescente.
//
// O id da linha nasce no cliente e é reaproveitado em toda tentativa de criação: repetir um create cuja
// resposta se perdeu não gera registro duplicado (o serviço trata o id já existente como atualização).
//
// Estado emitido: { status: 'idle'|'saving'|'saved'|'error', persisted, pendingSync, error }
//  - persisted: { [chaveDaSérie]: 'peso|reps' } do que o servidor/aparelho já confirmou;
//  - pendingSync: a última gravação ficou só neste aparelho (offline), aguardando sincronizar.

export function createRowSaver({
  createRow,
  updateRow,
  onChange,
  newId = () => crypto.randomUUID(),
  initialRow = null,
}) {
  let rowId = initialRow?.id || null
  let created = Boolean(rowId)
  let running = null
  let wanted = null
  let latest = null
  let state = {
    status: initialRow ? 'saved' : 'idle',
    persisted: initialRow?.persisted || {},
    pendingSync: Boolean(initialRow?.pendingSync),
    error: null,
  }

  function emit(patch) {
    state = { ...state, ...patch }
    onChange?.(state)
  }

  async function drain() {
    try {
      while (wanted) {
        const payload = wanted
        wanted = null
        emit({ status: 'saving', error: null })
        try {
          rowId ??= newId()
          const result = created
            ? await updateRow(rowId, payload)
            : await createRow(payload, { id: rowId })
          created = true
          emit({
            status: wanted ? 'saving' : 'saved',
            persisted: Object.fromEntries(
              (payload.setDetails || []).map((set) => [set.key, setValueKey(set)])
            ),
            pendingSync: Boolean(result?.pendingSync),
            error: null,
          })
        } catch (error) {
          emit({ status: wanted ? 'saving' : 'error', error })
        }
      }
    } finally {
      running = null
    }
  }

  function save(payload) {
    latest = payload
    wanted = payload
    running ??= drain()
    return running
  }

  return {
    save,
    // Reenvia o estado mais recente (botão "Tentar novamente" / volta da conexão).
    retry: () =>
      latest && state.status === 'error' ? save(latest) : (running ?? Promise.resolve()),
    getState: () => state,
    getRowId: () => rowId,
    whenIdle: async () => {
      while (running) await running
      return state
    },
  }
}
