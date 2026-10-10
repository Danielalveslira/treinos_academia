import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBObjectStore as FDBObjectStore } from 'fake-indexeddb'
import { freshDatabase, rawAll, withoutIndexedDb, workoutRow } from './testSupport.js'
import {
  BOOTSTRAP_SCHEMA_VERSION,
  buildBootstrapRecord,
  disableOfflineAccess,
  dropBootstrapsExcept,
  markBootstrapBlocked,
  minimalProfile,
  saveBootstrap,
} from './bootstrap.js'
import { evaluateOfflineEntry, offlineIdentity, readActiveBootstrap } from './bootstrapEntry.js'
import { OPERATIONS, enqueueWorkoutMutation, listMutations } from './outbox.js'
import { purgePrivateData } from './userScope.js'
import { recordWorkoutsPage, readCachedWorkouts } from './historyCache.js'
import { getStorageHealth, requestPersistentStorageOnce } from './storagePersistence.js'
import { APPROVED_LEGAL_DIGESTS } from '../../utils/legal.js'

beforeEach(freshDatabase)

const A = 'user-a'
const B = 'user-b'
const [VERSION, DIGEST] = Object.entries(APPROVED_LEGAL_DIGESTS).at(-1)
const NOW = Date.UTC(2026, 9, 5, 12)

// Perfil completo como o servidor devolve (mapUserRow): bem mais do que o bootstrap pode guardar.
const fullProfile = (id = A, overrides = {}) => ({
  id,
  role: 'superadmin',
  createdAt: '2026-10-01T10:00:00Z',
  username: 'maria',
  bio: 'privada',
  dataNascimento: '1990-01-01',
  sexo: 'feminino',
  heightCm: 170,
  avatarPath: 'a.jpg',
  usageProfile: 'x',
  accountStatus: 'active',
  shareStatistics: true,
  trainingPreferences: {
    plannedTrainingDays: ['monday'],
    reminderEnabled: false,
    timezone: 'America/Sao_Paulo',
  },
  disabledAt: null,
  disabledBy: null,
  disabledReason: null,
  legalAcceptance: { version: VERSION, digest: DIGEST, acceptedAt: '2026-10-01T10:00:00Z' },
  ...overrides,
})
const record = (overrides = {}) =>
  buildBootstrapRecord({
    userId: A,
    profile: fullProfile(),
    emailVerified: true,
    policy: { version: VERSION },
    allowed: true,
    now: NOW,
    ...overrides,
  })

// ------------------------------------------------------------------------------------- conteúdo

test('mensagens da Home offline: guarda só a voz escolhida (nunca o sexo); snapshot antigo segue válido', () => {
  const chosen = minimalProfile(fullProfile(A, { greetingVoice: 'feminino' }))
  assert.equal(chosen.greetingVoice, 'feminino')
  assert.equal(Object.hasOwn(chosen, 'sexo'), false)
  assert.equal(minimalProfile(fullProfile()).greetingVoice, 'auto') // sem escolha: automático
  // Registro gravado ANTES desta feature (sem a chave) continua sendo aceito para abrir offline.
  const legacy = record()
  delete legacy.profile.greetingVoice
  assert.equal(evaluateOfflineEntry(legacy).ok, true)
  assert.equal(offlineIdentity(legacy).profile.greetingVoice, undefined) // o app trata como 'auto' => neutro
})

test('o bootstrap guarda só o perfil MÍNIMO: sem role, e-mail, nascimento, sexo, altura, bio, avatar nem tokens', () => {
  const rec = record()
  assert.deepEqual(Object.keys(rec.profile).sort(), [
    'accountStatus',
    'createdAt',
    'greetingVoice', // só o estilo (auto/masculino/feminino/neutro) do texto da Home; o sexo continua fora
    'id',
    'trainingPreferences',
    'usageProfile', // só decide atalhos do menu (ex.: "Minha vitrine"); não é dado pessoal sensível
    'username',
  ])
  const text = JSON.stringify(rec)
  for (const forbidden of [
    'superadmin',
    'role',
    '@', // nenhum endereço de e-mail
    'dataNascimento',
    '1990',
    'sexo',
    'heightCm',
    'bio',
    'privada',
    'avatar',
    'token',
    'password',
    'refresh',
    'access_token',
    'balance',
    'coins',
    'cash',
    'Bearer',
  ]) {
    assert.ok(
      !text.toLowerCase().includes(forbidden.toLowerCase()),
      `não pode conter "${forbidden}"`
    )
  }
  assert.equal(rec.schema_version, BOOTSTRAP_SCHEMA_VERSION)
  assert.equal(minimalProfile(null), null)
})

test('a identidade offline NUNCA tem privilégio (role "user"), nem e-mail, e marca que não é sessão do servidor', () => {
  const identity = offlineIdentity(record())
  assert.equal(identity.user.offline, true)
  assert.equal(identity.user.uid, A)
  assert.equal(identity.profile.role, 'user') // o cache não concede admin
  assert.ok(!('email' in identity.user))
  assert.equal(identity.legalAccess.offline, true)
  assert.equal(identity.legalAccess.policy.version, VERSION)
  assert.equal(identity.legalAccess.restriction, null)
})

test('o perfil de uso (atalhos do menu) é restaurado offline; registro antigo sem o campo segue válido', () => {
  const identity = offlineIdentity(record({ profile: fullProfile(A, { usageProfile: 'common' }) }))
  assert.equal(identity.profile.usageProfile, 'common')
  const legacy = record()
  delete legacy.profile.usageProfile // bootstrap gravado antes deste campo existir
  assert.deepEqual(evaluateOfflineEntry(legacy), { ok: true, reason: null })
  assert.equal(offlineIdentity(legacy).profile.usageProfile, undefined)
})

// ------------------------------------------------------------------------------ quem pode entrar

test('registro confirmado online, ativo e com o aceite legal conhecido PODE abrir offline', () => {
  assert.deepEqual(evaluateOfflineEntry(record()), { ok: true, reason: null })
  assert.deepEqual(evaluateOfflineEntry(record(), { userId: A }), { ok: true, reason: null })
})

test('falha SEGURA: sem registro, corrompido, schema diferente, outro usuário ou revogado NÃO entram', () => {
  const ok = record()
  const cases = [
    [null, 'NO_BOOTSTRAP'],
    [undefined, 'NO_BOOTSTRAP'],
    ['lixo', 'NO_BOOTSTRAP'],
    [{ ...ok, schema_version: 99 }, 'SCHEMA_MISMATCH'],
    [{ ...ok, user_id: '' }, 'CORRUPTED'],
    [{ ...ok, offline_access: null }, 'CORRUPTED'],
    [{ ...ok, profile: null }, 'CORRUPTED'],
    [{ ...ok, profile: { ...ok.profile, id: 'outro' } }, 'CORRUPTED'],
    [{ ...ok, last_online_verified_at: 'ontem' }, 'CORRUPTED'],
    [{ ...ok, offline_access: { ...ok.offline_access, revoked_locally_at: NOW } }, 'REVOKED'],
    [
      {
        ...ok,
        offline_access: {
          ...ok.offline_access,
          enabled: false,
          blocked_reason: 'ACCOUNT_DELETING',
        },
      },
      'ACCOUNT_DELETING',
    ],
    [{ ...ok, profile: { ...ok.profile, accountStatus: 'disabled' } }, 'ACCOUNT_NOT_ACTIVE'],
  ]
  for (const [input, reason] of cases)
    assert.deepEqual(
      evaluateOfflineEntry(input),
      { ok: false, reason },
      JSON.stringify(input)?.slice(0, 60)
    )
  assert.deepEqual(evaluateOfflineEntry(ok, { userId: B }), { ok: false, reason: 'DIFFERENT_USER' })
})

test('o aceite legal NÃO é inventado: versão/digest desconhecidos, forjados ou ausentes não entram', () => {
  const ok = record()
  const withLegal = (legal) => ({ ...ok, legal: { ...ok.legal, ...legal } })
  for (const legal of [
    { accepted_version: '9.9.9' }, // versão que este app nunca aprovou
    { accepted_digest: 'f'.repeat(64) }, // digest forjado para uma versão conhecida
    { accepted_version: null },
    { accepted_digest: null },
    { accepted_at: null },
  ]) {
    assert.deepEqual(
      evaluateOfflineEntry(withLegal(legal)),
      { ok: false, reason: 'LEGAL_NOT_CONFIRMED' },
      JSON.stringify(legal)
    )
  }
  // Perfil sem aceite algum (conta que nunca aceitou) gera registro desabilitado.
  const never = buildBootstrapRecord({
    userId: A,
    profile: fullProfile(A, { legalAcceptance: null }),
    emailVerified: true,
    allowed: false,
    blockedReason: 'ACCEPTANCE_REQUIRED',
    now: NOW,
  })
  assert.equal(evaluateOfflineEntry(never).ok, false)
})

test('estado verificado online que NÃO permite acesso grava o bootstrap DESABILITADO com o motivo', () => {
  const blocked = record({ allowed: false, blockedReason: 'RESTRICTED' })
  assert.equal(blocked.offline_access.enabled, false)
  assert.equal(blocked.offline_access.blocked_reason, 'RESTRICTED')
  assert.deepEqual(evaluateOfflineEntry(blocked), { ok: false, reason: 'RESTRICTED' })
})

// ----------------------------------------------------------------------------------- persistência

test('salvar e ler o bootstrap ativo; ler sem nada devolve null', async () => {
  assert.equal(await readActiveBootstrap(), null)
  assert.equal(await saveBootstrap(record()), true)
  assert.deepEqual(await readActiveBootstrap(), record())
})

test('UM usuário ativo por aparelho: o login de B online invalida a entrada offline de A', async () => {
  await saveBootstrap(record())
  await saveBootstrap(
    buildBootstrapRecord({
      userId: B,
      profile: fullProfile(B),
      emailVerified: true,
      policy: { version: VERSION },
      allowed: true,
      now: NOW,
    })
  )
  const active = await readActiveBootstrap()
  assert.equal(active.user_id, B)
  assert.deepEqual(
    (await rawAll('offlineBootstrap')).map((r) => r.user_id),
    [B]
  ) // nada de A sobrou
})

test('A -> logout -> B: o cold start nunca expõe A', async () => {
  await saveBootstrap(record())
  await disableOfflineAccess() // logout explícito de A
  assert.equal(await readActiveBootstrap(), null)
  await saveBootstrap(
    buildBootstrapRecord({
      userId: B,
      profile: fullProfile(B),
      emailVerified: true,
      policy: { version: VERSION },
      allowed: true,
      now: NOW,
    })
  )
  const active = await readActiveBootstrap()
  assert.equal(active.user_id, B)
  assert.equal(evaluateOfflineEntry(active, { userId: A }).ok, false)
  assert.ok(!JSON.stringify(await rawAll('offlineBootstrap')).includes(A))
})

test('LOGOUT explícito: remove a autorização de abrir offline e NÃO apaga a outbox nem as linhas que ela carrega', async () => {
  await saveBootstrap(record())
  await enqueueWorkoutMutation(A, {
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
    now: NOW,
  })
  await recordWorkoutsPage(A, [workoutRow({ id: 'srv' })], { now: NOW })
  await disableOfflineAccess()
  await purgePrivateData(null) // o logout também limpa o cache descartável
  assert.equal(await readActiveBootstrap(), null)
  assert.equal((await rawAll('offlineBootstrap')).length, 0)
  assert.equal((await listMutations(A)).length, 1) // trabalho não sincronizado preservado
  assert.deepEqual(
    (await readCachedWorkouts(A)).rows.map((r) => r.id),
    ['e1']
  ) // só o que a outbox carrega
})

test('SESSÃO EXPIRADA / limpeza de cache sem logout: o bootstrap continua valendo (não é logout)', async () => {
  await saveBootstrap(record())
  await purgePrivateData(null) // o que acontece quando a sessão some sem logout do usuário
  await purgePrivateData(A)
  assert.equal(evaluateOfflineEntry(await readActiveBootstrap()).ok, true)
})

test('bloqueio visto online: markBootstrapBlocked desabilita a entrada offline até uma nova verificação liberar', async () => {
  await saveBootstrap(record())
  assert.equal(await markBootstrapBlocked(A, 'ACCEPTANCE_REQUIRED', NOW + 1), true)
  const blocked = await readActiveBootstrap()
  assert.deepEqual(evaluateOfflineEntry(blocked), { ok: false, reason: 'ACCEPTANCE_REQUIRED' })
  await saveBootstrap(record({ now: NOW + 2 })) // aceitou os novos termos online: libera de novo
  assert.equal(evaluateOfflineEntry(await readActiveBootstrap()).ok, true)
  assert.equal(await markBootstrapBlocked('', 'X'), false)
  assert.equal(await markBootstrapBlocked('desconhecido', 'X'), false)
})

test('dropBootstrapsExcept mantém só o usuário que fica', async () => {
  await saveBootstrap(record())
  await dropBootstrapsExcept(B)
  assert.equal(await readActiveBootstrap(), null)
  await saveBootstrap(record())
  await dropBootstrapsExcept(A)
  assert.equal((await readActiveBootstrap()).user_id, A)
})

test('registro CORROMPIDO no banco falha de forma segura (não entra, não lança)', async () => {
  await saveBootstrap(record())
  const db = await new Promise((resolve) => {
    const r = indexedDB.open('evolutus-local-v1')
    r.onsuccess = () => resolve(r.result)
  })
  await new Promise((resolve) => {
    const tx = db.transaction('offlineBootstrap', 'readwrite')
    tx.objectStore('offlineBootstrap').put({
      user_id: A,
      schema_version: 1,
      offline_access: 'quebrado',
    })
    tx.oncomplete = resolve
  })
  db.close()
  assert.equal(evaluateOfflineEntry(await readActiveBootstrap()).ok, false)
})

test('IndexedDB indisponível: nada é salvo, nada é lido, o logout não lança — o cold start falha de forma segura', async () => {
  const restore = withoutIndexedDb()
  try {
    assert.equal(await saveBootstrap(record()), false)
    assert.equal(await readActiveBootstrap(), null)
    assert.equal(await markBootstrapBlocked(A, 'X'), false)
    await assert.doesNotReject(disableOfflineAccess())
    assert.equal(evaluateOfflineEntry(await readActiveBootstrap()).ok, false)
  } finally {
    restore()
  }
})

// ------------------------------------------------------------------------------------- storage

function fakeStorage({ persisted = false, grant = true, usage = 10, quota = 100 } = {}) {
  const calls = { persist: 0 }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      storage: {
        persisted: async () => persisted,
        persist: async () => {
          calls.persist += 1
          return grant
        },
        estimate: async () => ({ usage, quota }),
      },
    },
  })
  return calls
}

test('storage: pede persistência UMA vez, respeita recusa, não insiste e não quebra sem a API', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    let calls = fakeStorage({ grant: true })
    assert.equal(await requestPersistentStorageOnce(), 'granted')
    assert.equal(await requestPersistentStorageOnce(), 'asked-before')
    assert.equal(calls.persist, 1)
    await freshDatabase()
    calls = fakeStorage({ grant: false })
    assert.equal(await requestPersistentStorageOnce(), 'denied')
    assert.equal(await requestPersistentStorageOnce(), 'asked-before') // recusa não vira prompt repetido
    assert.equal(calls.persist, 1)
    calls = fakeStorage({ persisted: true })
    assert.equal(await requestPersistentStorageOnce(), 'already')
    assert.equal(calls.persist, 0)
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    assert.equal(await requestPersistentStorageOnce(), 'unsupported')
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        storage: {
          persist: async () => {
            throw new Error('x')
          },
          persisted: async () => false,
        },
      },
    })
    await freshDatabase()
    assert.equal(await requestPersistentStorageOnce(), 'unsupported') // erro do navegador nunca propaga
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete globalThis.navigator
  }
})

test('storage: saúde do armazenamento (persistido, uso/cota, quase cheio)', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    fakeStorage({ persisted: true, usage: 95, quota: 100 })
    assert.deepEqual(await getStorageHealth(), {
      supported: true,
      persisted: true,
      usage: 95,
      quota: 100,
      nearlyFull: true,
    })
    fakeStorage({ persisted: false, usage: 5, quota: 100 })
    assert.equal((await getStorageHealth()).nearlyFull, false)
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    assert.deepEqual(await getStorageHealth(), {
      supported: false,
      persisted: false,
      usage: null,
      quota: null,
      nearlyFull: false,
    })
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete globalThis.navigator
  }
})

test('COTA EXCEDIDA ao gravar a mutação: o enfileiramento FALHA (nunca diz "salvo") e nada fica pela metade', async () => {
  const original = FDBObjectStore.prototype.put
  FDBObjectStore.prototype.put = function put(value, key) {
    if (this.name === 'outbox') throw new DOMException('quota', 'QuotaExceededError')
    return original.call(this, value, key)
  }
  try {
    await assert.rejects(
      enqueueWorkoutMutation(A, {
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
        now: NOW,
      }),
      (error) => error.name === 'QuotaExceededError'
    )
  } finally {
    FDBObjectStore.prototype.put = original
  }
  assert.deepEqual(await listMutations(A), [])
  assert.deepEqual(await rawAll('workouts'), []) // a linha local da mesma transação também não ficou
})
