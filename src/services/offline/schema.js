// Schema do banco local do Evolutus (IndexedDB). O número da versão é controlado SÓ por
// MIGRATIONS (nunca pelo hash do build): adicionar uma versão = acrescentar uma função ao fim
// do array. Migrations existentes nunca são editadas -- um aparelho pode estar em qualquer
// versão anterior e sobe passo a passo (v1 -> v2 -> v3...), preservando os dados.
//
// IndexedDB é uma RÉPLICA/CACHE do aparelho; o estado oficial continua no Supabase/PostgreSQL.
// Dados públicos (catálogo) não têm user_id; todo dado privado tem, na chave primária.

export const DB_NAME = 'evolutus-local-v1'

export const STORES = Object.freeze({
  // Público: public.exercise_catalog (leitura anônima). Sem user_id.
  exerciseCatalog: 'exerciseCatalog',
  // Privado: exercícios pessoais (public.exercises). Chave [user_id, id].
  userExercises: 'userExercises',
  // Privado: public.workouts -- uma linha por exercício por dia (set_details jsonb, date).
  workouts: 'workouts',
  // Chave/valor. Chaves privadas começam com `user:<id>:` (ver userMetaKey).
  syncMeta: 'syncMeta',
  // Privado e NÃO descartável: mutações feitas offline que ainda não chegaram ao servidor. Diferente
  // dos caches acima, nunca é apagada por logout/troca de conta/limpeza (ver userScope).
  outbox: 'outbox',
  // Privado, por usuário: fotografia MÍNIMA da conta para abrir o app sem internet (cold start). Sem tokens.
  offlineBootstrap: 'offlineBootstrap',
})

// Stores que são CACHE (reconstruíveis a partir do servidor) -- podem ser apagadas a qualquer hora.
// A outbox fica de fora de propósito: apagar uma mutação pendente é perder trabalho do usuário.
export const DISPOSABLE_STORES = Object.freeze([
  STORES.exerciseCatalog,
  STORES.userExercises,
  STORES.workouts,
  STORES.syncMeta,
])

export const USER_META_PREFIX = 'user:'

export function userMetaKey(userId, name) {
  return `${USER_META_PREFIX}${userId}:${name}`
}

// Nomes (sufixos de userMetaKey) dos registros por usuário que o cold start lê numa ÚNICA transação.
export const HOME_SNAPSHOT_META = 'home-snapshot'
export const ROLLOUT_META = 'offline-rollout'

// Cada migration recebe o banco e a transação de versionchange. Só pode criar/alterar stores e
// índices (e mover dados dentro da própria transação).
export const MIGRATIONS = [
  // v1 -- leitura offline: catálogo público, exercícios pessoais e histórico recente.
  (db) => {
    const catalog = db.createObjectStore(STORES.exerciseCatalog, { keyPath: 'id' })
    // Não-único de propósito: uma linha recriada no catálogo (novo id, mesmo provider/id externo)
    // não pode fazer o put falhar com ConstraintError; exerciseCache remove a antiga.
    catalog.createIndex('byProvider', ['provider', 'providerExerciseId'])
    catalog.createIndex('byCachedAt', 'cachedAt')

    const exercises = db.createObjectStore(STORES.userExercises, { keyPath: ['user_id', 'id'] })
    exercises.createIndex('byUser', 'user_id')

    const workouts = db.createObjectStore(STORES.workouts, { keyPath: ['user_id', 'id'] })
    workouts.createIndex('byUser', 'user_id')
    // Mesma ordenação do servidor (date desc, created_at desc), por usuário.
    workouts.createIndex('byUserDate', ['user_id', 'date', 'created_at'])

    db.createObjectStore(STORES.syncMeta, { keyPath: 'key' })
  },
  // v2 -- escrita offline (Fase 3): fila de mutações. Só ADICIONA uma store; nenhum dado da v1 é tocado.
  (db) => {
    const outbox = db.createObjectStore(STORES.outbox, { keyPath: 'mutation_id' })
    // Ordem determinística por usuário: `seq` cresce a cada mutação enfileirada daquele usuário.
    outbox.createIndex('byUserSeq', ['user_id', 'seq'], { unique: true })
    outbox.createIndex('byUserEntity', ['user_id', 'entity_id'])
  },
  // v3 -- cold start offline (Fase 4): bootstrap local por usuário. Só ADICIONA uma store.
  (db) => {
    db.createObjectStore(STORES.offlineBootstrap, { keyPath: 'user_id' })
  },
]

export const DB_VERSION = MIGRATIONS.length

export function runMigrations(db, transaction, oldVersion, newVersion = DB_VERSION) {
  for (let version = oldVersion; version < newVersion; version += 1) {
    MIGRATIONS[version](db, transaction)
  }
}
