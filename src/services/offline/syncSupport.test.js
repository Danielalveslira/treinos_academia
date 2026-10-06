import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createProbe } from './connectivity.js'
import { createSyncChannel, SYNC_CHANNEL } from './syncChannel.js'
import {
  describeSyncStatus,
  getSyncSnapshot,
  markSynced,
  resetSyncStatusForTests,
  setOnline,
  setSaving,
  setSyncing,
  setSyncUser,
  refreshSyncStatus,
  subscribeSync,
} from './syncStatusStore.js'
import { freshDatabase } from './testSupport.js'
import {
  OPERATIONS,
  enqueueWorkoutMutation,
  failMutation,
  claimNextBatch,
  completeMutation,
} from './outbox.js'
import { isOfflineCapablePath } from '../../utils/offlineRoutes.js'
import { FINISH_MESSAGES, runFinishWorkout } from '../../utils/finishWorkout.js'

beforeEach(async () => {
  await freshDatabase()
  resetSyncStatusForTests()
})

// ------------------------------------------------------------------------------------------ probe

test('probe: não confia em navigator.onLine=true; testa o backend e guarda o resultado (sem polling)', async () => {
  let calls = 0
  let clock = 0
  const probe = createProbe({
    baseUrl: 'https://x.supabase.co/',
    anonKey: 'k',
    now: () => clock,
    fetcher: async (url, init) => {
      calls += 1
      assert.equal(url, 'https://x.supabase.co/auth/v1/health')
      assert.equal(init.headers.apikey, 'k')
      assert.equal(init.cache, 'no-store')
      return { status: 200 }
    },
  })
  assert.equal(await probe.probe(), true)
  assert.equal(await probe.probe(), true)
  assert.equal(calls, 1) // resultado reaproveitado
  clock = 16_000
  await probe.probe()
  assert.equal(calls, 2)
})

test('probe: Wi‑Fi sem saída (fetch falha) e 5xx = inalcançável; 4xx prova que o backend responde', async () => {
  let mode = 'fail'
  let clock = 0
  const probe = createProbe({
    baseUrl: 'https://x.co',
    now: () => clock,
    fetcher: async () => {
      if (mode === 'fail') throw new TypeError('Failed to fetch')
      return { status: mode === '502' ? 502 : 401 }
    },
  })
  assert.equal(await probe.probe(), false)
  mode = '502'
  clock = 4000
  assert.equal(await probe.probe(), false)
  mode = '401'
  clock = 8000
  assert.equal(await probe.probe(), true)
})

test('probe: sem URL configurada não bloqueia; markReachable evita nova sondagem', async () => {
  assert.equal(await createProbe({}).probe(), true)
  let calls = 0
  const probe = createProbe({
    baseUrl: 'https://x.co',
    fetcher: async () => {
      calls += 1
      return { status: 200 }
    },
  })
  probe.markReachable()
  assert.equal(await probe.probe(), true)
  assert.equal(calls, 0)
})

// ------------------------------------------------------------------------------------- canal entre abas

test('BroadcastChannel: mensagens de OUTRA instância chegam; mensagens inválidas são ignoradas', async () => {
  const instances = []
  class FakeBC {
    constructor(name) {
      assert.equal(name, SYNC_CHANNEL)
      this.name = name
      instances.push(this)
    }
    postMessage(message) {
      for (const other of instances) if (other !== this) other.onmessage?.({ data: message })
    }
    close() {}
  }
  const tab1 = createSyncChannel({ BroadcastChannelImpl: FakeBC })
  const tab2 = createSyncChannel({ BroadcastChannelImpl: FakeBC })
  assert.equal(tab1.transport, 'broadcast-channel')
  const received = []
  tab2.subscribe((m) => received.push(m.type))
  tab1.post('sync-started', 'user-a')
  tab1.post('outbox-changed', 'user-a')
  instances[0].postMessage({ type: 'hacker', userId: 'user-a' })
  instances[0].postMessage('lixo')
  instances[0].postMessage({ type: 'sync-completed' }) // sem userId
  assert.deepEqual(received, ['sync-started', 'outbox-changed'])
})

test('sem BroadcastChannel cai no evento storage (só outras abas); sem nada, não quebra', () => {
  const listeners = new Map()
  const target = {
    addEventListener: (n, f) => listeners.set(n, f),
    removeEventListener: (n) => listeners.delete(n),
  }
  const store = new Map()
  const storage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null }
  const channel = createSyncChannel({ BroadcastChannelImpl: null, storage, target })
  assert.equal(channel.transport, 'storage')
  const got = []
  channel.subscribe((m) => got.push(m.type))
  channel.post('sync-completed', 'user-a')
  assert.ok(store.get('evolutus:sync-signal'))
  // O navegador dispara `storage` na OUTRA aba:
  listeners.get('storage')({
    key: 'evolutus:sync-signal',
    newValue: store.get('evolutus:sync-signal'),
  })
  listeners.get('storage')({ key: 'outra-chave', newValue: '{}' })
  listeners.get('storage')({ key: 'evolutus:sync-signal', newValue: '{corrompido' })
  assert.deepEqual(got, ['sync-completed'])
  channel.close()
  assert.equal(listeners.size, 0)

  const none = createSyncChannel({ BroadcastChannelImpl: null, storage: null, target: {} })
  assert.equal(none.transport, 'none')
  assert.doesNotThrow(() => none.post('sync-started', 'u'))
})

// ---------------------------------------------------------------------------------- SyncStatus (texto)

const snap = (overrides = {}) => ({
  online: true,
  saving: false,
  syncing: false,
  pending: 0,
  failed: 0,
  justSynced: false,
  ...overrides,
})

test('SyncStatus: cada estado pedido tem o texto certo', () => {
  const on = { writeEnabled: true }
  assert.equal(
    describeSyncStatus(snap({ online: false }), on).text,
    'Offline • dados deste aparelho'
  )
  assert.equal(describeSyncStatus(snap({ saving: true }), on).text, 'Salvando neste aparelho…')
  assert.equal(
    describeSyncStatus(snap({ pending: 1 }), on).text,
    '1 alteração aguardando sincronização'
  )
  assert.equal(
    describeSyncStatus(snap({ pending: 3 }), on).text,
    '3 alterações aguardando sincronização'
  )
  assert.equal(describeSyncStatus(snap({ syncing: true, pending: 3 }), on).text, 'Sincronizando…')
  assert.equal(describeSyncStatus(snap({ justSynced: true }), on).text, 'Sincronizado')
  assert.equal(describeSyncStatus(snap({ failed: 1 }), on).text, 'Falha ao sincronizar')
  assert.equal(
    describeSyncStatus(snap({ failed: 2 }), on).detail,
    '2 alterações precisam de atenção'
  )
  assert.equal(describeSyncStatus(snap({ failed: 1 }), on).detail, '1 alteração precisa de atenção')
  assert.equal(
    describeSyncStatus(snap({ online: false, pending: 2 }), on).text,
    'Offline • 2 alterações salvas neste aparelho'
  )
  assert.equal(
    describeSyncStatus(snap({ online: false, pending: 1 }), on).text,
    'Offline • 1 alteração salva neste aparelho'
  )
})

test('SyncStatus: tudo em dia fica oculto; salvar/sincronizar têm prioridade; "Sincronizar agora" só online', () => {
  const on = { writeEnabled: true }
  assert.equal(describeSyncStatus(snap(), on).visible, false)
  assert.equal(
    describeSyncStatus(snap({ saving: true, syncing: true, failed: 1 }), on).kind,
    'saving'
  )
  assert.equal(describeSyncStatus(snap({ syncing: true, failed: 1 }), on).kind, 'syncing')
  assert.equal(describeSyncStatus(snap({ failed: 1, online: false }), on).canSync, false)
  assert.equal(describeSyncStatus(snap({ pending: 1 }), on).canSync, true)
})

test('SyncStatus com a flag de escrita DESLIGADA: nada aparece (nem offline), a menos que haja pendências herdadas', () => {
  const off = { writeEnabled: false }
  assert.equal(describeSyncStatus(snap({ online: false }), off).visible, false)
  assert.equal(describeSyncStatus(snap({ saving: true }), off).visible, false)
  assert.equal(describeSyncStatus(snap({ justSynced: true }), off).visible, false)
  assert.equal(describeSyncStatus(snap({ pending: 2 }), off).visible, true) // rollback: a fila existente continua visível
})

// ------------------------------------------------------------------------- store: salvo -> sincronizando -> sincronizado

test('store: transições salvo neste aparelho -> aguardando -> sincronizando -> sincronizado', async () => {
  setSyncUser('user-a')
  const seen = []
  const unsub = subscribeSync(() =>
    seen.push(describeSyncStatus(getSyncSnapshot(), { writeEnabled: true }).kind)
  )
  // Mesma ordem de localWrites.queueWorkoutWrite: o espelho é recontado ANTES de sair de "salvando".
  setSaving(true)
  await enqueueWorkoutMutation('user-a', {
    operation: OPERATIONS.create,
    entityId: 'e1',
    payload: {
      exercise_id: 'x',
      date: '2026-10-05',
      type: 'strength',
      set_details: [{ weight: 1, reps: 1 }],
      sets: 1,
      note: '',
    },
  })
  await refreshSyncStatus('user-a')
  setSaving(false)
  assert.equal(getSyncSnapshot().pending, 1)
  // Sync: em andamento, ACK, fila zerada, "Sincronizado".
  setSyncing(true)
  const [mutation] = await claimNextBatch('user-a')
  await completeMutation('user-a', mutation, { status: 'applied' })
  await refreshSyncStatus('user-a')
  markSynced()
  setSyncing(false) // mesma ordem de syncScheduler.runOnce: sem piscar entre syncing e synced
  unsub()
  assert.deepEqual([...new Set(seen)], ['saving', 'pending', 'syncing', 'synced'])
  assert.equal(getSyncSnapshot().pending, 0)
})

test('store: pendência SOBREVIVE ao reload (o espelho é recontado do IndexedDB) e falhas aparecem separadas', async () => {
  await enqueueWorkoutMutation('user-a', {
    operation: OPERATIONS.create,
    entityId: 'e1',
    payload: {
      exercise_id: 'x',
      date: '2026-10-05',
      type: 'strength',
      set_details: [{ weight: 1, reps: 1 }],
      sets: 1,
      note: '',
    },
  })
  resetSyncStatusForTests() // "reload": a memória zerou
  assert.equal(getSyncSnapshot().pending, 0)
  setSyncUser('user-a')
  await refreshSyncStatus()
  assert.equal(
    describeSyncStatus(getSyncSnapshot(), { writeEnabled: false }).text,
    '1 alteração aguardando sincronização'
  )
  const [m] = await claimNextBatch('user-a')
  await failMutation('user-a', m.mutation_id, { code: 'CONFLICT' })
  await refreshSyncStatus()
  assert.equal(getSyncSnapshot().failed, 1)
  assert.equal(getSyncSnapshot().pending, 0)
})

test('store: refresh de outro usuário não polui o estado do usuário atual', async () => {
  setSyncUser('user-a')
  await enqueueWorkoutMutation('user-b', {
    operation: OPERATIONS.create,
    entityId: 'e9',
    payload: {
      exercise_id: 'x',
      date: '2026-10-05',
      type: 'strength',
      set_details: [{ weight: 1, reps: 1 }],
      sets: 1,
      note: '',
    },
  })
  await refreshSyncStatus('user-a')
  assert.equal(getSyncSnapshot().pending, 0)
  setOnline(false)
  assert.equal(getSyncSnapshot().online, false)
})

// ------------------------------------------------------------------------------ bloqueio seletivo e finalizar

test('offline: só leitura local e registro de treino funcionam; o resto exige servidor', () => {
  for (const path of [
    '/',
    '/exercicios',
    '/exercicios/abc',
    '/novo-treino',
    '/historico',
    '/progresso',
  ]) {
    assert.equal(isOfflineCapablePath(path), true, path)
  }
  for (const path of [
    '/evocash',
    '/minhas-promocoes',
    '/admin/compras-evocash',
    '/admin/contas',
    '/comunidades',
    '/comunidades/1',
    '/perfil',
    '/minha-vitrine',
    '/exercicios/a/b',
  ]) {
    assert.equal(isOfflineCapablePath(path), false, path)
  }
})

const finishDeps = (overrides = {}) => {
  const calls = { flush: 0, complete: 0 }
  return {
    calls,
    deps: {
      isOnline: () => true,
      getDay: async () => '2026-10-05',
      flushPending: async () => {
        calls.flush += 1
        return { pending: 0, failed: 0 }
      },
      completeSession: async () => {
        calls.complete += 1
      },
      classifyError: () => 'other',
      ...overrides,
    },
  }
}

test('FINALIZAR TREINO offline: bloqueado, NÃO chama o servidor, NÃO enfileira e a mensagem é a combinada', async () => {
  const { calls, deps } = finishDeps({ isOnline: () => false })
  assert.deepEqual(await runFinishWorkout(deps), { outcome: 'offline' })
  assert.deepEqual(calls, { flush: 0, complete: 0 })
  assert.equal(
    FINISH_MESSAGES.offline,
    'Conecte-se à internet para finalizar o treino. Seus registros continuam salvos neste aparelho.'
  )
})

test('finalizar online: esvazia a fila ANTES de pedir a conclusão (o servidor só vê o que sincronizou)', async () => {
  const order = []
  const { deps } = finishDeps({
    flushPending: async () => {
      order.push('flush')
      return { pending: 0, failed: 0 }
    },
    completeSession: async () => {
      order.push('complete')
    },
  })
  assert.equal((await runFinishWorkout(deps)).outcome, 'done')
  assert.deepEqual(order, ['flush', 'complete'])
})

test('finalizar com registros ainda pendentes: não pede a conclusão (evita "esforço insuficiente" sobre dados que estão só no aparelho)', async () => {
  const { calls, deps } = finishDeps({ flushPending: async () => ({ pending: 2, failed: 0 }) })
  assert.deepEqual(await runFinishWorkout(deps), { outcome: 'pending', remaining: 2 })
  assert.equal(calls.complete, 0)
})

test('finalizar: a rede cai no meio vira "offline"; qualquer outro erro continua sendo erro; nunca há recompensa local', async () => {
  const net = finishDeps({
    completeSession: async () => {
      throw { message: 'TypeError: Failed to fetch' }
    },
    classifyError: () => 'connectivity',
  })
  assert.equal((await runFinishWorkout(net.deps)).outcome, 'offline')
  const other = finishDeps({
    completeSession: async () => {
      throw new Error('APP_ACCESS_DENIED')
    },
  })
  const result = await runFinishWorkout(other.deps)
  assert.equal(result.outcome, 'error')
  assert.ok(result.error)
})

test('orçamento de boot: o Layout NÃO importa a pilha de sync estaticamente (SyncStatus lazy, scheduler por import())', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const layout = read('../../components/Layout.jsx')
  const hook = read('../../hooks/useSyncScheduler.js')
  assert.ok(!/from '\.\/SyncStatus'/.test(layout), 'SyncStatus deve ser lazy')
  assert.match(layout, /lazy\(\(\)\s*=>\s*import\('\.\/SyncStatus'\)/)
  assert.ok(!/from '\.\.\/services\/offline\/sync/.test(layout))
  assert.ok(
    !/^import .*services\/offline/m.test(hook),
    'o hook só pode importar o scheduler dinamicamente'
  )
  assert.match(hook, /import\('\.\.\/services\/offline\/syncScheduler\.js'\)/)
})

test('finalizar: conflito/falha DESTE treino pede atenção e não conclui; mensagem própria', async () => {
  const { calls, deps } = finishDeps({ flushPending: async () => ({ pending: 0, failed: 1 }) })
  assert.deepEqual(await runFinishWorkout(deps), { outcome: 'attention', failed: 1 })
  assert.equal(calls.complete, 0)
  assert.match(FINISH_MESSAGES.attention, /precisam de atenção/)
  // Falha tem prioridade sobre "aguardando": é o que o usuário precisa resolver.
  const both = finishDeps({ flushPending: async () => ({ pending: 3, failed: 1 }) })
  assert.equal((await runFinishWorkout(both.deps)).outcome, 'attention')
})

test('finalizar: nada pendente DESTE treino conclui, mesmo que existam pendências de outros dias (flush só informa as do treino)', async () => {
  const { calls, deps } = finishDeps({
    flushPending: async () => ({ pending: 0, failed: 0, other: 5 }),
  })
  assert.equal((await runFinishWorkout(deps)).outcome, 'done')
  assert.equal(calls.complete, 1)
})

test('finalizar: sync necessário que FALHA (lança) vira erro e não conclui', async () => {
  const { calls, deps } = finishDeps({
    flushPending: async () => {
      throw new Error('storage')
    },
  })
  assert.equal((await runFinishWorkout(deps)).outcome, 'error')
  assert.equal(calls.complete, 0)
})

test('probe: `force` ignora o resultado "inalcançável" em cache (evento online / Sincronizar agora não podem ficar mudos por 3 s)', async () => {
  let ok = false
  let calls = 0
  let clock = 0
  const probe = createProbe({
    baseUrl: 'https://x.co',
    now: () => clock,
    fetcher: async () => {
      calls += 1
      if (!ok) throw new TypeError('Failed to fetch')
      return { status: 200 }
    },
  })
  assert.equal(await probe.probe(), false)
  ok = true
  clock = 500 // dentro da janela de 3 s
  assert.equal(await probe.probe(), false) // sem force, respeita o cache (não martela o backend)
  assert.equal(calls, 1)
  assert.equal(await probe.probe({ force: true }), true) // com force, tenta de verdade
  assert.equal(calls, 2)
  assert.equal(await probe.probe(), true) // e o novo resultado vale a partir daí
})

test('finalizar: o DIA vem do servidor e é o mesmo usado para escolher as mutações a sincronizar', async () => {
  let flushedDay = null
  const { deps } = finishDeps({
    getDay: async () => '2026-10-04', // o servidor ainda considera o dia 04 (virada de São Paulo não chegou)
    flushPending: async (day) => {
      flushedDay = day
      return { pending: 0, failed: 0 }
    },
  })
  assert.equal((await runFinishWorkout(deps)).outcome, 'done')
  assert.equal(flushedDay, '2026-10-04')
})

test('finalizar: falha de CONECTIVIDADE ao obter o dia do servidor vira "offline" (nunca conclui nem inventa o dia)', async () => {
  const { calls, deps } = finishDeps({
    getDay: async () => {
      throw { message: 'TypeError: Failed to fetch', code: '' }
    },
    classifyError: (error) => (/Failed to fetch/.test(error.message) ? 'connectivity' : 'other'),
  })
  assert.equal((await runFinishWorkout(deps)).outcome, 'offline')
  assert.deepEqual(calls, { flush: 0, complete: 0 })
})
