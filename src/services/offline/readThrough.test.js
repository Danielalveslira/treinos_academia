import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { freshDatabase } from './testSupport.js'
import { classifyReadError } from './readError.js'
import { isLocalFallback, markLocalFallback } from './localFallback.js'
import { readThrough } from './readThrough.js'
import { fetchCached, getCached, clearPageCache } from '../../utils/pageCache.js'

beforeEach(async () => {
  await freshDatabase()
  clearPageCache()
})

// Erro real do postgrest-js quando o fetch falha: não lança, devolve este objeto e os serviços o relançam.
const NETWORK = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }

test('classifyReadError: falhas de rede são conectividade', () => {
  for (const error of [
    NETWORK,
    { message: 'FetchError: network timeout', code: '' },
    { message: 'TypeError: Load failed', code: '' },
    new TypeError('Failed to fetch'),
    { message: 'Bad gateway', status: 502 },
    { message: 'x', status: 503 },
    { message: 'x', status: 504 },
    { message: 'x', status: 0 },
  ]) {
    assert.equal(classifyReadError(error, { online: true }), 'connectivity', JSON.stringify(error))
  }
  // Sem código nem mensagem reconhecível só vira conectividade se o navegador souber que está offline.
  assert.equal(classifyReadError({ message: 'qualquer coisa' }, { online: true }), 'other')
  assert.equal(classifyReadError({ message: 'qualquer coisa' }, { online: false }), 'connectivity')
})

test('classifyReadError: auth/permissão NUNCA é conectividade, nem com o navegador offline', () => {
  for (const error of [
    { code: 'PGRST301', message: 'JWT expired' },
    { code: 'PGRST302', message: 'x' },
    { code: '42501', message: 'permission denied for table workouts' },
    { status: 401, message: 'Unauthorized' },
    { status: 403, message: 'Forbidden' },
    { message: 'NOT_AUTHENTICATED' },
    { message: 'APP_ACCESS_DENIED' },
    { message: 'JWT expired', code: '' },
    { name: 'AuthApiError', message: 'Invalid Refresh Token: Refresh Token Not Found' },
  ]) {
    assert.equal(classifyReadError(error, { online: false }), 'auth', JSON.stringify(error))
  }
})

test('classifyReadError: erros do servidor com código, cancelamento e vazio seguem como "other"', () => {
  assert.equal(
    classifyReadError({ code: '23505', message: 'duplicate key' }, { online: false }),
    'other'
  )
  assert.equal(classifyReadError({ code: 'PGRST116', message: 'x' }, { online: true }), 'other')
  const abort = {
    message: 'FetchError: The user aborted a request.',
    hint: 'Request was aborted',
    code: '',
  }
  assert.equal(classifyReadError(abort, { online: false }), 'other')
  assert.equal(
    classifyReadError(Object.assign(new Error('x'), { name: 'AbortError' }), { online: false }),
    'other'
  )
  assert.equal(classifyReadError(null), 'other')
})

test('online: devolve o resultado do servidor e persiste em segundo plano', async () => {
  const persisted = []
  const value = await readThrough({
    remote: async () => ({ ok: 1 }),
    persist: (v) => persisted.push(v),
    local: () => assert.fail('não deveria ler o cache online'),
  })
  assert.deepEqual(value, { ok: 1 })
  assert.equal(isLocalFallback(value), false)
  await setImmediate()
  assert.deepEqual(persisted, [{ ok: 1 }])
})

test('modo local reconhecido lê só o IndexedDB e nunca chama o backend protegido', async () => {
  let remoteCalls = 0
  const value = await readThrough({
    localOnly: true,
    remote: () => {
      remoteCalls += 1
      throw new Error('backend não pode ser chamado')
    },
    persist: () => assert.fail('cache local não é resposta do servidor'),
    local: () => ({ items: ['treino salvo'] }),
  })
  assert.equal(remoteCalls, 0)
  assert.deepEqual(value.items, ['treino salvo'])
  assert.equal(isLocalFallback(value), true)
})

test('persistência lenta não atrasa a leitura e falha de persistência não derruba a leitura', async () => {
  let release
  const slow = new Promise((resolve) => (release = resolve))
  const value = await readThrough({
    remote: async () => 'v',
    persist: () => slow,
    local: () => undefined,
  })
  assert.equal(value, 'v') // chegou sem esperar a persistência
  release()

  const warn = console.warn
  console.warn = () => {}
  try {
    const again = await readThrough({
      label: 'falha-persist',
      remote: async () => 'v2',
      persist: () => Promise.reject(new Error('quota')),
      local: () => undefined,
    })
    assert.equal(again, 'v2')
    await setImmediate()
  } finally {
    console.warn = warn
  }
})

test('persist que lança de forma síncrona também não derruba a leitura', async () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(
      await readThrough({
        label: 'sync-throw',
        remote: async () => 7,
        persist: () => {
          throw new Error('x')
        },
        local: () => undefined,
      }),
      7
    )
  } finally {
    console.warn = warn
  }
})

test('falha de conectividade com dado local: devolve o local, marcado como fallback', async () => {
  const value = await readThrough({
    remote: async () => {
      throw NETWORK
    },
    persist: () => {},
    local: async () => ({ items: [1] }),
  })
  assert.deepEqual(value, { items: [1] })
  assert.equal(isLocalFallback(value), true)
})

test('falha de conectividade SEM dado local: propaga o erro ORIGINAL (nunca um vazio inventado)', async () => {
  await assert.rejects(
    readThrough({
      remote: async () => {
        throw NETWORK
      },
      persist: () => {},
      local: async () => undefined,
    }),
    (error) => error === NETWORK
  )
})

test('erro de autenticação/autorização NÃO é mascarado por cache, mesmo havendo dado local', async () => {
  for (const error of [
    { code: 'PGRST301', message: 'JWT expired' },
    { code: '42501', message: 'permission denied' },
    { status: 401, message: 'x' },
  ]) {
    await assert.rejects(
      readThrough({
        remote: async () => {
          throw error
        },
        persist: () => {},
        local: async () => ({ items: ['segredo'] }),
      }),
      (thrown) => thrown === error
    )
  }
})

test('outros erros (SQL, validação, abort) propagam sem cache', async () => {
  const error = { code: '22P02', message: 'invalid input syntax' }
  await assert.rejects(
    readThrough({
      remote: async () => {
        throw error
      },
      persist: () => {},
      local: async () => ({ items: [1] }),
    }),
    (e) => e === error
  )
})

test('falha ao ler o cache local nunca esconde o erro de rede original', async () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    await assert.rejects(
      readThrough({
        label: 'local-quebrado',
        remote: async () => {
          throw NETWORK
        },
        persist: () => {},
        local: async () => {
          throw new Error('idb')
        },
      }),
      (error) => error === NETWORK
    )
  } finally {
    console.warn = warn
  }
})

test('marcador: só objetos, não altera o valor e não vaza entre valores', () => {
  const list = [1, 2]
  assert.equal(markLocalFallback(list), list)
  assert.equal(isLocalFallback(list), true)
  assert.equal(isLocalFallback([1, 2]), false)
  assert.equal(markLocalFallback('texto'), 'texto')
  assert.equal(isLocalFallback('texto'), false)
  assert.equal(isLocalFallback(null), false)
  assert.deepEqual(list, [1, 2])
})

test('pageCache: resultado vindo do IndexedDB nunca é memorizado; o do servidor continua sendo', async () => {
  const local = markLocalFallback({ items: ['antigo'] })
  assert.equal(await fetchCached('k-local', async () => local), local)
  assert.equal(getCached('k-local'), undefined)
  const fresh = { items: ['novo'] }
  await fetchCached('k-fresh', async () => fresh)
  assert.equal(getCached('k-fresh'), fresh)
})
