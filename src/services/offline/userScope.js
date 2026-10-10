import { attempt, iterate, request, trackPurge, withTransaction } from './database.js'
import { STORES, USER_META_PREFIX, userMetaKey } from './schema.js'
import { clearRoutineImageManifest } from './exerciseImagePrep.js'

// Isolamento por usuário do banco local. Quatro camadas independentes:
//  1. toda linha privada tem user_id na CHAVE PRIMÁRIA e toda leitura/escrita filtra por ele
//     (dado da conta A nunca é lido pela conta B, mesmo que continue no disco);
//  2. esta limpeza remove o CACHE que não pertence à sessão atual assim que a identidade muda;
//  3. no logout (nenhum usuário) todo CACHE privado é apagado -- só o catálogo público (sem dono)
//     permanece;
//  4. a OUTBOX (mutações ainda não sincronizadas) NUNCA é apagada aqui, e as linhas locais dos
//     registros que ela ainda carrega também ficam. Apagar o que o usuário registrou e o servidor não
//     recebeu seria perder treino. Quem pode ler/sincronizar cada mutação é decidido pelo user_id dela
//     (leituras, o Sync Engine e o servidor, que usa auth.uid()): outra conta jamais a enxerga.
//
// Separação explícita: cache descartável (reconstruível do servidor)  x  mutações não sincronizadas
// (trabalho do usuário). Só o primeiro é limpo por esta função.
//
// Chamada por AuthContext a cada troca REAL de identidade (login, logout, outro usuário; eventos
// repetidos da mesma sessão não chegam aqui). Nunca lança e nunca é aguardada pela UI.
const CACHE_STORES = [STORES.userExercises, STORES.workouts]

// keepUserId = id da sessão que está ficando (login/troca) ou null (logout).
export function purgePrivateData(keepUserId = null) {
  const idbPurge = trackPurge(
    attempt(
      'purge',
      () =>
        withTransaction(
          [...CACHE_STORES, STORES.syncMeta, STORES.outbox],
          'readwrite',
          async (stores) => {
            // Registros que a outbox ainda carrega (de QUALQUER usuário) não são cache: ficam.
            const queued = await request(stores[STORES.outbox].getAll())
            const protectedKeys = new Set(queued.map((m) => `${m.user_id}|${m.entity_id}`))

            for (const name of CACHE_STORES) {
              const store = stores[name]
              const protect = name === STORES.workouts && protectedKeys.size > 0
              if (keepUserId == null && !protect) {
                store.clear()
                continue
              }
              // Só as chaves (user_id, chave primária): não carrega os registros para decidir.
              await iterate(
                store.index('byUser'),
                null,
                'next',
                (cursor) => {
                  if (keepUserId != null && cursor.key === keepUserId) return
                  const [userId, id] = cursor.primaryKey
                  if (protect && protectedKeys.has(`${userId}|${id}`)) return
                  store.delete(cursor.primaryKey)
                },
                { keysOnly: true }
              )
            }
            const keepPrefix = keepUserId == null ? null : userMetaKey(keepUserId, '')
            // Chaves privadas de syncMeta: 'user:<id>:...'. ';' é o caractere seguinte a ':', então
            // ['user:', 'user;') cobre exatamente o prefixo e deixa as chaves públicas de fora.
            await iterate(
              stores[STORES.syncMeta],
              IDBKeyRange.bound(USER_META_PREFIX, 'user;', false, true),
              'next',
              (cursor) => {
                if (!keepPrefix || !cursor.key.startsWith(keepPrefix)) cursor.delete()
              }
            )
          }
        ),
      undefined
    )
  )
  // Cache Storage (manifesto de imagens da rotina, ver exerciseImagePrep.js) não é IndexedDB e não
  // tem user_id -- só é limpo no logout explícito (sem conta nenhuma usando o aparelho). Numa troca
  // DIRETA entre duas contas (keepUserId != null), o manifesto da conta anterior some sozinho na
  // próxima vez que qualquer uma das contas preparar imagens de novo -- as imagens em si são
  // públicas (mesmo bucket pra qualquer conta), só a prioridade de eviction é afetada, nunca dado
  // privado. Começa em paralelo com a limpeza do IndexedDB (nenhuma trava de uma sobre a outra);
  // fica de fora do `trackPurge`/gate de escrita, que é só sobre o IndexedDB.
  if (keepUserId != null) return idbPurge
  const manifestClear = clearRoutineImageManifest().catch(() => {})
  return Promise.all([idbPurge, manifestClear]).then(() => undefined)
}
