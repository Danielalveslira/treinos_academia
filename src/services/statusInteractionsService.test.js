import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Enquetes e treinos marcados do feed carregam o estado em LOTE (1 chamada de totais + 1 de "o que
// é meu" por tipo), não 2 chamadas por card. Supabase é um fake que grava a forma das chamadas.
let directory
const calls = []
let rpcResponses = {}
let tableResponses = {}

async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'status-interactions-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export * from './statusInteractionsService.js'`,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'fake-supabase',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/supabase\/config(\.js)?$/ }, (args) => ({
            path: args.path,
            namespace: 'fake',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
            contents: `
              const make = (kind, name) => {
                const call = { kind, name, ops: [] }
                globalThis.__calls.push(call)
                const q = new Proxy({}, {
                  get(_, op) {
                    if (op === 'then') {
                      const src = kind === 'rpc' ? globalThis.__rpc : globalThis.__tables
                      let r = src[name] ?? { data: [], error: null }
                      if (typeof r === 'function') r = r(call)
                      return (resolve, reject) => Promise.resolve(r).then(resolve, reject)
                    }
                    return (...args) => { call.ops.push([op, ...args]); return q }
                  },
                })
                return q
              }
              export const supabase = { from: (t) => make('table', t), rpc: (fn, args) => { const q = make('rpc', fn); q.__args = args; globalThis.__calls.at(-1).args = args; return q } }
            `,
          }))
        },
      },
    ],
  })
  globalThis.__calls = calls
  return createRequire(import.meta.url)(outfile)
}

const svc = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
beforeEach(() => {
  calls.length = 0
  rpcResponses = {}
  tableResponses = {}
  globalThis.__rpc = rpcResponses
  globalThis.__tables = tableResponses
  svc.resetBatchRpcAvailability()
})
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

test('enquetes: 12 cards na mesma janela geram 1 RPC de totais + 1 leitura dos meus votos', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `p${i}`)
  rpcResponses.get_poll_results_batch = {
    data: [
      { status_id: 'p0', option_id: 'a', votes: '3' },
      { status_id: 'p0', option_id: 'b', votes: 1 },
      { status_id: 'p5', option_id: 'a', votes: 2 },
    ],
    error: null,
  }
  tableResponses.status_votes = { data: [{ status_id: 'p0', option_id: 'b' }], error: null }
  const states = await Promise.all(ids.map((id) => svc.loadPollState(id, 'u1')))
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map((c) => c.name).sort(), ['get_poll_results_batch', 'status_votes'])
  assert.deepEqual(calls.find((c) => c.kind === 'rpc').args.p_status_ids, ids)
  assert.deepEqual(states[0], { counts: { a: 3, b: 1 }, myOptionId: 'b' })
  assert.deepEqual(states[5], { counts: { a: 2 }, myOptionId: null })
  assert.deepEqual(states[7], { counts: {}, myOptionId: null })
  const mine = calls.find((c) => c.name === 'status_votes').ops
  assert.ok(mine.some(([op, col, v]) => op === 'eq' && col === 'user_id' && v === 'u1'))
})

test('treinos: lote com 1 RPC + 1 leitura da minha participação; sem linha = 0 confirmados', async () => {
  rpcResponses.count_workout_participants_batch = {
    data: [{ status_id: 'w1', participants: 4 }],
    error: null,
  }
  tableResponses.status_participants = { data: [{ status_id: 'w1' }], error: null }
  const [w1, w2] = await Promise.all([
    svc.loadWorkoutState('w1', 'u1'),
    svc.loadWorkoutState('w2', 'u1'),
  ])
  assert.equal(calls.length, 2)
  assert.deepEqual(w1, { count: 4, amParticipant: true })
  assert.deepEqual(w2, { count: 0, amParticipant: false })
})

test('mais de 50 cards viram mais de um lote, nunca um por card', async () => {
  rpcResponses.get_poll_results_batch = { data: [], error: null }
  tableResponses.status_votes = { data: [], error: null }
  await Promise.all(Array.from({ length: 120 }, (_, i) => svc.loadPollState(`p${i}`, 'u1')))
  assert.equal(calls.filter((c) => c.name === 'get_poll_results_batch').length, 3)
  assert.equal(calls.filter((c) => c.name === 'status_votes').length, 3)
})

test('chamadas repetidas do mesmo card na janela compartilham o mesmo resultado', async () => {
  rpcResponses.get_poll_results_batch = { data: [], error: null }
  tableResponses.status_votes = { data: [], error: null }
  await Promise.all([svc.loadPollState('p1', 'u1'), svc.loadPollState('p1', 'u1')])
  assert.equal(calls.length, 2)
})

test('RPC em lote ainda não existe (migration pendente): cai nas funções unitárias e lembra disso', async () => {
  rpcResponses.get_poll_results_batch = {
    data: null,
    error: { code: 'PGRST202', message: 'not found' },
  }
  rpcResponses.get_poll_results = () => ({
    data: [{ option_id: 'a', votes: '2' }],
    error: null,
  })
  tableResponses.status_votes = { data: [], error: null }
  const states = await Promise.all([svc.loadPollState('p1', 'u1'), svc.loadPollState('p2', 'u1')])
  assert.deepEqual(states[0].counts, { a: 2 })
  assert.equal(calls.filter((c) => c.name === 'get_poll_results').length, 2)
  calls.length = 0
  await svc.loadPollState('p3', 'u1')
  await tick()
  assert.equal(
    calls.filter((c) => c.name === 'get_poll_results_batch').length,
    0,
    'não tenta de novo a RPC ausente'
  )
})

test('erro real da RPC em lote rejeita para todos os cards do lote (cada card oferece "Tentar novamente")', async () => {
  rpcResponses.get_poll_results_batch = { data: null, error: { code: '57014', message: 'timeout' } }
  tableResponses.status_votes = { data: [], error: null }
  const results = await Promise.allSettled([
    svc.loadPollState('p1', 'u1'),
    svc.loadPollState('p2', 'u1'),
  ])
  assert.deepEqual(
    results.map((r) => r.status),
    ['rejected', 'rejected']
  )
})

test('usuários diferentes não compartilham lote (a leitura "meu" é por usuário)', async () => {
  rpcResponses.get_poll_results_batch = { data: [], error: null }
  tableResponses.status_votes = { data: [], error: null }
  await Promise.all([svc.loadPollState('p1', 'u1'), svc.loadPollState('p1', 'u2')])
  assert.equal(calls.filter((c) => c.name === 'status_votes').length, 2)
})
