import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

// P0 (continuação da auditoria, 2026-11-10): retomada de criação pendente após reload. Testa a
// lógica de corrida isolada (sem montar React) -- resolvePendingCreate() e os helpers de
// sessionStorage são puros o suficiente para isso. pendingCreate.js importa workoutSheetsService.js
// (que por sua vez importa supabase/config, sem extensão -- só resolve via bundler, não Node ESM
// puro), então segue o mesmo padrão de esbuild já usado em workoutSheetsService.test.js: a RPC
// real nunca é chamada aqui (cada teste injeta seu próprio `fetchSheet`), só precisa existir pra
// o módulo carregar.
let dir, mod
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pending-create-'))
  const file = join(dir, 'pending-create.cjs')
  await build({
    entryPoints: [resolve('src/features/workoutSheets/pendingCreate.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: file,
    plugins: [
      {
        name: 'rpc-boundary',
        setup(b) {
          b.onResolve({ filter: /supabase\/config$/ }, () => ({
            path: 'config',
            namespace: 'fake',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
            contents:
              "export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:'test-user'}}}})},rpc:async()=>({data:null,error:null})}",
          }))
        },
      },
    ],
  })
  mod = createRequire(import.meta.url)(file)
})
after(async () => {
  await rm(dir, { recursive: true, force: true })
})

let store
beforeEach(() => {
  store = new Map()
  globalThis.sessionStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  }
})

// mod só é atribuído dentro de before(); lido de forma tardia em cada teste via api().
function api() {
  return mod
}

const NOT_FOUND = Object.assign(new Error('SHEET_NOT_FOUND'), {})
const NETWORK_ERROR = Object.assign(new Error('Failed to fetch'), {})
const SESSION_REVOKED = Object.assign(new Error('SESSION_REVOKED'), {})
const FAST = { delays: [0, 0] } // nunca espera 400ms/900ms de verdade num teste

test('cenário 1/3: criação original ainda comitando no servidor -- a 1ª consulta vê SHEET_NOT_FOUND, mas a tentativa seguinte (dentro da tolerância) já encontra a ficha', async () => {
  let calls = 0
  const fetchSheet = async () => {
    calls += 1
    if (calls === 1) throw NOT_FOUND
    return { id: 'sheet-1', revision: 2 }
  }
  const result = await api().resolvePendingCreate('req-1', { ...FAST, fetchSheet })
  assert.equal(result.status, 'found')
  assert.equal(result.sheet.id, 'sheet-1')
  assert.equal(calls, 2, 'retomou a verificação em vez de desistir na 1ª resposta')
})

test('cenário 2: SHEET_NOT_FOUND se mantém mesmo após a tolerância -- só então é tratado como ausência confirmada, nunca na 1ª resposta isolada', async () => {
  let calls = 0
  const fetchSheet = async () => {
    calls += 1
    throw NOT_FOUND
  }
  const result = await api().resolvePendingCreate('req-2', { ...FAST, fetchSheet })
  assert.equal(result.status, 'confirmed-missing')
  // 1 chamada original + 2 tentativas de tolerância (FAST.delays tem 2 posições).
  assert.equal(calls, 3, 'só confirma ausência depois de esgotar a tolerância, nunca de imediato')
})

test('cenário 4: falha de rede durante a recuperação nunca é tratada como prova de que a tentativa falhou', async () => {
  let calls = 0
  const fetchSheet = async () => {
    calls += 1
    throw NETWORK_ERROR
  }
  const result = await api().resolvePendingCreate('req-3', { ...FAST, fetchSheet })
  assert.equal(result.status, 'check-failed')
  assert.equal(result.error, NETWORK_ERROR)
  assert.equal(
    calls,
    1,
    'erro de rede não entra no loop de tolerância do SHEET_NOT_FOUND -- falha imediatamente, sem repetir às cegas'
  )
})

test('cenário 5: falha de sessão/autenticação tem o mesmo tratamento seguro de qualquer outra falha de verificação', async () => {
  const fetchSheet = async () => {
    throw SESSION_REVOKED
  }
  const result = await api().resolvePendingCreate('req-4', { ...FAST, fetchSheet })
  assert.equal(result.status, 'check-failed')
  assert.equal(result.error, SESSION_REVOKED)
})

test('cenário 6: repetir a mesma verificação com o mesmo identificador é idempotente (nenhum efeito colateral extra na própria função)', async () => {
  let calls = 0
  const fetchSheet = async () => {
    calls += 1
    return { id: 'sheet-5', revision: 1 }
  }
  const first = await api().resolvePendingCreate('req-5', { ...FAST, fetchSheet })
  const second = await api().resolvePendingCreate('req-5', { ...FAST, fetchSheet })
  assert.deepEqual(first, second)
  assert.equal(
    calls,
    2,
    'cada chamada consulta o servidor de novo -- nenhum cache escondido que poderia ficar desatualizado'
  )
})

test('cenário 7/isolamento: helpers de sessionStorage -- descarte seguro nunca afeta outra conta, e uma leitura sem marcador nunca inventa um id', () => {
  const { readPendingCreateRequestId: read, writePendingCreateRequestId: write } = api()
  write('user-a', null)
  write('user-b', null)
  assert.equal(read('user-a'), null, 'sem marcador para começar')

  write('user-a', 'req-a')
  write('user-b', 'req-b')
  assert.equal(read('user-a'), 'req-a')
  assert.equal(read('user-b'), 'req-b', 'contas diferentes nunca compartilham a mesma chave')

  // Descarte seguro (ausência confirmada ou sucesso) só afeta a conta atual.
  write('user-a', null)
  assert.equal(read('user-a'), null, 'descartado: uma criação nova pode mintar um id independente')
  assert.equal(read('user-b'), 'req-b', 'conta B nunca é afetada pelo descarte da conta A')
})
