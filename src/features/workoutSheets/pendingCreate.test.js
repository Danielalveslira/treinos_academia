import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readPendingCreateSnapshot, writePendingCreateSnapshot } from './pendingCreate.js'

// P0 (continuação da auditoria, 2026-11-10): a retomada de criação pendente deixou de depender de
// uma janela de tolerância por tempo (nenhum intervalo fixo prova que uma transação terminou) e
// passou a restaurar, de forma síncrona e local, o payload validado da última tentativa sob a
// MESMA identidade (create_request_id) -- quem resolve a concorrência de fato é o lock por conta
// já existente em create_workout_sheet(), nunca uma estimativa aqui. Este arquivo testa só a
// leitura/escrita/validação estrutural do snapshot; a prova de que duas tentativas concorrentes
// com o mesmo identificador nunca produzem duas fichas está em
// supabase/tests/workout_sheet_create_concurrency.sh (conexões reais, não atrasos simulados).

let store
beforeEach(() => {
  store = new Map()
  globalThis.sessionStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  }
})

const sheet = { name: 'Treino A', goal: null, goal_description: '', weekdays: [], items: [] }

test('grava e lê o snapshot da mesma conta: identidade e payload preservados exatamente', () => {
  writePendingCreateSnapshot('user-a', 'req-1', sheet)
  const read = readPendingCreateSnapshot('user-a')
  assert.equal(read.requestId, 'req-1')
  assert.deepEqual(read.sheet, sheet)
})

test('sem snapshot: nunca inventa um id nem um payload', () => {
  assert.equal(readPendingCreateSnapshot('user-a'), null)
})

test('isolamento entre contas: a conta B nunca vê nem é afetada pelo snapshot da conta A', () => {
  writePendingCreateSnapshot('user-a', 'req-a', sheet)
  writePendingCreateSnapshot('user-b', 'req-b', { ...sheet, name: 'Treino B' })
  assert.equal(readPendingCreateSnapshot('user-a').requestId, 'req-a')
  assert.equal(readPendingCreateSnapshot('user-b').requestId, 'req-b')

  // Descarte seguro (conclusão ou cancelamento resolvido) só afeta a própria conta.
  writePendingCreateSnapshot('user-a', null, null)
  assert.equal(readPendingCreateSnapshot('user-a'), null)
  assert.equal(readPendingCreateSnapshot('user-b').requestId, 'req-b')
})

test('integridade estrutural: JSON corrompido, versão desconhecida ou formato incompleto nunca são interpretados como pendência real', () => {
  const key = 'evolutus:sheet:pendingCreate:user-c'
  store.set(key, '{not valid json')
  assert.equal(readPendingCreateSnapshot('user-c'), null, 'JSON corrompido')

  store.set(key, JSON.stringify({ version: 999, requestId: 'req-c', sheet }))
  assert.equal(readPendingCreateSnapshot('user-c'), null, 'versão desconhecida/antiga')

  store.set(key, JSON.stringify({ version: 1, requestId: '', sheet }))
  assert.equal(readPendingCreateSnapshot('user-c'), null, 'requestId vazio')

  store.set(key, JSON.stringify({ version: 1, requestId: 'req-c', sheet: { name: 'A' } }))
  assert.equal(readPendingCreateSnapshot('user-c'), null, 'ficha sem items[] estruturado')

  store.set(key, JSON.stringify({ version: 1, requestId: 'req-c', sheet: { items: [] } }))
  assert.equal(readPendingCreateSnapshot('user-c'), null, 'ficha sem nome')
})

test('armazenamento indisponível nunca derruba o fluxo: leitura e escrita falham em silêncio', () => {
  const broken = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('blocked')
    },
    removeItem() {
      throw new Error('blocked')
    },
  }
  globalThis.sessionStorage = broken
  assert.doesNotThrow(() => writePendingCreateSnapshot('user-d', 'req-d', sheet))
  assert.equal(readPendingCreateSnapshot('user-d'), null)
})

test('descarte explícito (requestId/sheet nulos) remove o snapshot em vez de gravar um vazio', () => {
  writePendingCreateSnapshot('user-e', 'req-e', sheet)
  assert.ok(readPendingCreateSnapshot('user-e'))
  writePendingCreateSnapshot('user-e', null, null)
  assert.equal(readPendingCreateSnapshot('user-e'), null)
})
