import { DB_NAME, DB_VERSION, runMigrations } from './schema.js'
import { getOfflineRolloutUser, isRolloutAllowed } from './rollout.js'

// Única porta de entrada do IndexedDB do Evolutus. Componentes e serviços de domínio nunca
// tocam o IndexedDB direto: usam os módulos de cache (exerciseCache, historyCache, ...), que
// usam withTransaction daqui.
//
// Contrato: o banco local é um ACELERADOR/RÉPLICA, nunca um requisito. Indisponível (navegador
// sem suporte, modo privado, cota, bloqueio por outra aba, versão mais nova que o código,
// desligado por flag) => openDatabase() devolve null e os módulos de cache degradam para "sem
// cache"; o app segue 100% pelo Supabase.

const OPEN_TIMEOUT_MS = 4000
const RETRY_AFTER_FAILURE_MS = 30_000

export class OfflineStorageUnavailableError extends Error {
  constructor(message = 'Armazenamento local indisponível') {
    super(message)
    this.name = 'OfflineStorageUnavailableError'
  }
}

// Kill switch de rollout: só o texto exato 'false' desliga (VITE_OFFLINE_READ_ENABLED).
export function isOfflineReadEnabled(env = import.meta.env) {
  return env?.VITE_OFFLINE_READ_ENABLED !== 'false'
}

// Escrita offline (outbox + sync). Desligada por padrão até a validação da Fase 3: só o texto exato
// 'true' liga (VITE_OFFLINE_WRITE_ENABLED). Independente da flag de leitura. Com ela desligada o
// fluxo online de gravação é exatamente o anterior à Fase 3.
export function isOfflineWriteEnabled(env = import.meta.env, userId = getOfflineRolloutUser()) {
  return (
    env?.VITE_OFFLINE_WRITE_ENABLED === 'true' &&
    isRolloutAllowed(env, userId, 'offline_write')
  )
}

// Cold start offline (abrir o app SEM internet com a conta já reconhecida neste aparelho). Desligado por
// padrão: só 'true' liga (VITE_OFFLINE_COLD_START_ENABLED). Independente da escrita offline, mas depende do
// banco local (precisa de VITE_OFFLINE_READ_ENABLED, que é o padrão): sem IndexedDB não há bootstrap.
export function isOfflineColdStartEnabled(env = import.meta.env, userId = null) {
  return (
    env?.VITE_OFFLINE_COLD_START_ENABLED === 'true' &&
    isOfflineReadEnabled(env) &&
    // Sem identidade, devolve só a configuração para que o boot possa consultar o
    // bootstrap local. A decisão de ENTRAR é refeita abaixo com o user_id confirmado.
    (!userId || isRolloutAllowed(env, userId, 'offline_cold_start'))
  )
}

// A casca do app deixa de ser bloqueada sem rede quando QUALQUER modo offline está ligado (escrita ou cold
// start): as telas que exigem servidor passam a mostrar aviso por tela, em vez da tela cheia.
export function isOfflineShellEnabled(env = import.meta.env) {
  const userId = getOfflineRolloutUser()
  return (
    isOfflineWriteEnabled(env, userId) ||
    (!env?.PROD && isOfflineColdStartEnabled(env)) ||
    (Boolean(userId) && isOfflineColdStartEnabled(env, userId))
  )
}

let dbPromise = null
let lastFailureAt = 0
let lastStorageDiagnosticAt = 0

function noteStorageUnavailable() {
  if (Date.now() - lastStorageDiagnosticAt < 60_000) return
  lastStorageDiagnosticAt = Date.now()
  import('./telemetry.js').then(({ queueOfflineTelemetry }) =>
    queueOfflineTelemetry('indexeddb_unavailable')).catch(() => {})
}

function resetConnection() {
  dbPromise = null
}

export function openDatabase() {
  if (!isOfflineReadEnabled()) return Promise.resolve(null)
  const factory = globalThis.indexedDB
  if (!factory) {
    noteStorageUnavailable()
    return Promise.resolve(null)
  }
  if (dbPromise) return dbPromise
  // Depois de uma falha, não martela o navegador a cada leitura: tenta de novo só após um tempo.
  if (lastFailureAt && Date.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS)
    return Promise.resolve(null)

  const attempt = new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (db) => {
      if (settled) {
        // Abertura que terminou depois do prazo (ex.: outra aba liberou o upgrade): ninguém a
        // espera mais, então não deixa uma conexão aberta sobrando.
        db?.close()
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(db)
    }
    let request
    try {
      request = factory.open(DB_NAME, DB_VERSION)
    } catch (error) {
      console.warn('[offline] IndexedDB indisponível:', error?.name)
      finish(null)
      return
    }
    timer = setTimeout(() => {
      console.warn('[offline] abertura do IndexedDB demorou demais (bloqueada por outra aba?)')
      finish(null)
    }, OPEN_TIMEOUT_MS)
    request.onupgradeneeded = (event) => {
      try {
        runMigrations(
          request.result,
          request.transaction,
          event.oldVersion,
          event.newVersion ?? DB_VERSION
        )
      } catch (error) {
        // Migration falhou: aborta a transação de versionchange (o banco volta ao estado anterior,
        // nada fica pela metade) e o app segue sem cache.
        console.error('[offline] migration falhou:', error)
        try {
          request.transaction.abort()
        } catch {
          /* já abortada */
        }
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // Outra aba pediu upgrade: libera a conexão para não bloquear a migration dela.
      db.onversionchange = () => {
        db.close()
        resetConnection()
      }
      db.onclose = resetConnection
      finish(db)
    }
    request.onerror = () => {
      // Inclui VersionError (banco mais novo que este código, ex.: após rollback de deploy): os
      // dados não são tocados.
      console.warn('[offline] não foi possível abrir o IndexedDB:', request.error?.name)
      finish(null)
    }
    // onblocked: outra aba segura uma conexão antiga; o open continua pendente até o prazo acima.
  }).then((db) => {
    if (!db) {
      noteStorageUnavailable()
      resetConnection()
      lastFailureAt = Date.now()
    } else {
      lastFailureAt = 0
    }
    return db
  })
  dbPromise = attempt
  return attempt
}

// Fecha a conexão e zera o estado (testes, e reabertura limpa após erro de estado inválido).
export async function closeDatabase() {
  const pending = dbPromise
  resetConnection()
  lastFailureAt = 0
  const db = await pending
  db?.close()
}

export function request(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result)
    idbRequest.onerror = () => reject(idbRequest.error)
  })
}

// Percorre um cursor (de store ou índice). `visit(cursor)` devolve false para parar.
export function iterate(source, range, direction, visit, { keysOnly = false } = {}) {
  return new Promise((resolve, reject) => {
    const cursorRequest = keysOnly
      ? source.openKeyCursor(range, direction)
      : source.openCursor(range, direction)
    cursorRequest.onerror = () => reject(cursorRequest.error)
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) {
        resolve()
        return
      }
      let keepGoing
      try {
        keepGoing = visit(cursor)
      } catch (error) {
        reject(error)
        return
      }
      if (keepGoing === false) resolve()
      else cursor.continue()
    }
  })
}

// Gate de limpeza de dados privados (logout/troca de conta): escritas esperam a limpeza em curso
// terminar, para uma gravação do usuário NOVO nunca ser apagada por uma limpeza do ANTERIOR que
// ainda não acabou. Leituras não esperam -- elas já são sempre filtradas por user_id.
let purgeGate = Promise.resolve()

export function trackPurge(promise) {
  const settled = promise.then(
    () => undefined,
    () => undefined
  )
  purgeGate = purgeGate.then(() => settled)
  return promise
}

// Executa `work(stores, tx)` numa transação. `work` só pode aguardar requisições do IndexedDB
// (request/iterate): qualquer outro await deixaria a transação encerrar. A promessa resolve com
// o retorno de `work` quando a transação CONFIRMA (oncomplete), e rejeita se ela abortar.
export async function withTransaction(storeNames, mode, work) {
  if (mode === 'readwrite') await purgeGate
  const db = await openDatabase()
  if (!db) throw new OfflineStorageUnavailableError()
  return new Promise((resolve, reject) => {
    let tx
    try {
      tx = db.transaction(storeNames, mode)
    } catch (error) {
      // Conexão fechando (InvalidStateError): descarta e reabre na próxima.
      resetConnection()
      reject(error)
      return
    }
    let result
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(tx.error || new Error('Transação do IndexedDB abortada'))
    const stores = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name)]))
    let running
    try {
      running = Promise.resolve(work(stores, tx))
    } catch (error) {
      running = Promise.reject(error)
    }
    running.then(
      (value) => {
        result = value
      },
      (error) => {
        try {
          tx.abort()
        } catch {
          /* já finalizada */
        }
        reject(error)
      }
    )
  })
}

const warned = new Set()

// Roda uma operação de cache sem nunca propagar falha: devolve `fallback` e registra UMA vez por
// rótulo (sem texto de erro, que poderia carregar dado do usuário).
export async function attempt(label, operation, fallback) {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof OfflineStorageUnavailableError) && !warned.has(label)) {
      warned.add(label)
      console.warn(`[offline] ${label} falhou:`, error?.name || 'Error')
    }
    return fallback
  }
}
