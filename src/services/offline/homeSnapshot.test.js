import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBDatabase as FDBDatabase } from 'fake-indexeddb'
import { freshDatabase, rawAll } from './testSupport.js'
import {
  HOME_SNAPSHOT_VERSION,
  homeSnapshotKey,
  saveHomeSnapshot,
  slimProgressDay,
  validateHomeSnapshot,
} from './homeSnapshot.js'
import { readOfflineEntry } from './bootstrapEntry.js'
import {
  buildBootstrapRecord,
  disableOfflineAccess,
  dropBootstrapsExcept,
  saveBootstrap,
} from './bootstrap.js'
import { purgePrivateData } from './userScope.js'
import { userMetaKey } from './schema.js'
import { APPROVED_LEGAL_DIGESTS } from '../../utils/legal.js'

beforeEach(freshDatabase)

const A = 'user-a'
const B = 'user-b'
const [VERSION, DIGEST] = Object.entries(APPROVED_LEGAL_DIGESTS).at(-1)
const NOW = Date.UTC(2026, 9, 8, 12)

const profileOf = (id) => ({
  id,
  username: id,
  createdAt: '2026-10-01T10:00:00Z',
  accountStatus: 'active',
  trainingPreferences: null,
  usageProfile: 'common',
  legalAcceptance: { version: VERSION, digest: DIGEST, acceptedAt: '2026-10-01T10:00:00Z' },
})
const bootstrapOf = (id, now = NOW) =>
  buildBootstrapRecord({
    userId: id,
    profile: profileOf(id),
    emailVerified: true,
    policy: { version: VERSION },
    allowed: true,
    now,
  })

const WALLET = { coinBalance: 20, lifetimeCoinsEarned: 35, cashBalance: 320 }
const DAILY = { earned: 3, limit: 10, day: '2026-10-08' }
const DAY = {
  id: '2026-10-07',
  dateKey: '2026-10-07',
  workoutCount: 2,
  active: true,
  strengthVolumeKg: 1200,
  strengthSets: 9,
  strengthReps: 80,
  cardioMinutes: 0,
  cardioDistanceKm: 0,
  exerciseStats: [
    { exerciseId: 'e1', workoutCount: 1, maxWeightKg: 60, estimated1RMKg: 80, strengthSets: 4 },
    { exerciseId: 'e2', workoutCount: 1, maxWeightKg: 40 },
  ],
}
const PROGRESS = { start: '2025-12-01', end: '2026-12-31', days: [DAY] }

// ------------------------------------------------------------------------------------------ gravação

test('grava o snapshot agregado numa única chave por usuário, com versão, dono e saved_at', async () => {
  assert.equal(await saveHomeSnapshot(A, { wallet: WALLET }, { at: NOW }), true)
  const rows = (await rawAll('syncMeta')).filter((row) => row.key.startsWith('user:'))
  assert.deepEqual(rows.map((row) => row.key), [homeSnapshotKey(A)])
  assert.equal(homeSnapshotKey(A), userMetaKey(A, 'home-snapshot'))
  const value = rows[0].value
  assert.equal(value.schema_version, HOME_SNAPSHOT_VERSION)
  assert.equal(value.user_id, A)
  assert.equal(value.saved_at, NOW)
  assert.deepEqual(value.wallet, { ...WALLET, saved_at: NOW })
})

test('seções são mescladas: gravar o saldo não apaga a atividade, e cada seção tem o próprio saved_at', async () => {
  await saveHomeSnapshot(A, { progress: PROGRESS }, { at: NOW })
  await saveHomeSnapshot(A, { wallet: WALLET, daily_coins: DAILY }, { at: NOW + 5000 })
  const [row] = (await rawAll('syncMeta')).filter((r) => r.key === homeSnapshotKey(A))
  assert.equal(row.value.progress.saved_at, NOW)
  assert.equal(row.value.wallet.saved_at, NOW + 5000)
  assert.equal(row.value.daily_coins.saved_at, NOW + 5000)
  assert.equal(row.value.saved_at, NOW + 5000)
  assert.equal(row.value.progress.days.length, 1)
})

test('guarda só o necessário: o dia da Home perde séries, 1RM e cardio (isso é da tela de Progresso)', () => {
  const slim = slimProgressDay(DAY)
  assert.deepEqual(slim, {
    dateKey: '2026-10-07',
    workoutCount: 2,
    strengthVolumeKg: 1200,
    exerciseStats: [{ exerciseId: 'e1' }, { exerciseId: 'e2' }],
  })
  assert.equal(slimProgressDay({ workoutCount: 1 }), null)
  assert.equal(slimProgressDay(null), null)
})

test('valor real ZERO é guardado como zero (≠ ausência de snapshot); valores inválidos são recusados', async () => {
  await saveHomeSnapshot(A, { wallet: { coinBalance: 0, cashBalance: 0, lifetimeCoinsEarned: 0 } }, { at: NOW })
  const [row] = (await rawAll('syncMeta')).filter((r) => r.key === homeSnapshotKey(A))
  assert.equal(row.value.wallet.coinBalance, 0)
  assert.equal(await saveHomeSnapshot(B, { wallet: { coinBalance: '20', cashBalance: null } }, { at: NOW }), false)
  assert.equal(await saveHomeSnapshot(B, { wallet: { coinBalance: NaN, cashBalance: 1 } }, { at: NOW }), false)
  assert.equal(await saveHomeSnapshot(B, {}, { at: NOW }), false)
  assert.equal(await saveHomeSnapshot(null, { wallet: WALLET }), false)
  assert.equal((await rawAll('syncMeta')).some((r) => r.key === homeSnapshotKey(B)), false)
})

// -------------------------------------------------------------------------------------------- validação

test('validação: versão desconhecida, outro dono, saved_at inválido ou formato estranho => sem snapshot', () => {
  const good = { schema_version: HOME_SNAPSHOT_VERSION, user_id: A, saved_at: NOW, wallet: { ...WALLET, saved_at: NOW } }
  assert.equal(validateHomeSnapshot(good, A).wallet.cashBalance, 320)
  assert.equal(validateHomeSnapshot({ ...good, schema_version: 99 }, A), null)
  assert.equal(validateHomeSnapshot(good, B), null, 'snapshot de A nunca vale para B')
  assert.equal(validateHomeSnapshot({ ...good, user_id: B }, A), null)
  assert.equal(validateHomeSnapshot({ ...good, saved_at: 'ontem' }, A), null)
  assert.equal(validateHomeSnapshot(null, A), null)
  assert.equal(validateHomeSnapshot('x', A), null)
  assert.equal(validateHomeSnapshot(good, null), null)
})

test('validação: seção corrompida é descartada sozinha, as outras sobrevivem', () => {
  const value = {
    schema_version: HOME_SNAPSHOT_VERSION,
    user_id: A,
    saved_at: NOW,
    wallet: { coinBalance: 'x', cashBalance: 1 },
    daily_coins: { ...DAILY, saved_at: NOW },
    progress: { days: 'não é lista' },
  }
  const snapshot = validateHomeSnapshot(value, A)
  assert.equal(snapshot.wallet, undefined)
  assert.equal(snapshot.progress, undefined)
  assert.equal(snapshot.daily_coins.earned, 3)
})

// ------------------------------------------------------------------------------- leitura única do boot

test('o cold start lê bootstrap + snapshot + rollout numa ÚNICA transação (sem várias leituras no boot)', async () => {
  await saveBootstrap(bootstrapOf(A))
  await saveHomeSnapshot(A, { wallet: WALLET, progress: PROGRESS }, { at: NOW })
  const rollout = { offline_write: { enabled: true }, offline_cold_start: { enabled: true } }
  const { openDatabase, request, withTransaction } = await import('./database.js')
  await withTransaction(['syncMeta'], 'readwrite', ({ syncMeta }) => {
    syncMeta.put({ key: userMetaKey(A, 'offline-rollout'), value: rollout })
  })
  await openDatabase() // abertura fora da contagem
  const original = FDBDatabase.prototype.transaction
  let transactions = 0
  FDBDatabase.prototype.transaction = function (...args) {
    transactions += 1
    return original.apply(this, args)
  }
  try {
    const entry = await readOfflineEntry()
    assert.equal(transactions, 1, 'uma transação para tudo')
    assert.equal(entry.record.user_id, A)
    assert.equal(entry.home.wallet.coinBalance, 20)
    assert.equal(entry.home.progress.days[0].dateKey, '2026-10-07')
    assert.deepEqual(entry.rollout, rollout)
  } finally {
    FDBDatabase.prototype.transaction = original
  }
  assert.ok(request)
})

test('sem bootstrap ativo não há entrada: nem record, nem snapshot, nem rollout', async () => {
  await saveHomeSnapshot(A, { wallet: WALLET }, { at: NOW })
  assert.deepEqual(await readOfflineEntry(), { record: null, home: null, rollout: null })
})

test('o snapshot de A NUNCA aparece para B: o bootstrap ativo (B) só enxerga a chave de B', async () => {
  await saveHomeSnapshot(A, { wallet: WALLET }, { at: NOW })
  await saveBootstrap(bootstrapOf(B))
  const entry = await readOfflineEntry()
  assert.equal(entry.record.user_id, B)
  assert.equal(entry.home, null)
  await saveHomeSnapshot(B, { wallet: { coinBalance: 1, cashBalance: 2, lifetimeCoinsEarned: 1 } }, { at: NOW })
  assert.equal((await readOfflineEntry()).home.wallet.cashBalance, 2)
})

test('registro com user_id trocado dentro da chave de B não vale (defesa contra dado cruzado)', async () => {
  await saveBootstrap(bootstrapOf(B))
  const { withTransaction } = await import('./database.js')
  await withTransaction(['syncMeta'], 'readwrite', ({ syncMeta }) => {
    syncMeta.put({
      key: homeSnapshotKey(B),
      value: { schema_version: 1, user_id: A, saved_at: NOW, wallet: { ...WALLET, saved_at: NOW } },
    })
  })
  assert.equal((await readOfflineEntry()).home, null)
})

// --------------------------------------------------------------------- logout / troca de conta / limpeza

test('LOGOUT explícito apaga o snapshot da conta que saiu, junto com o bootstrap', async () => {
  await saveBootstrap(bootstrapOf(A))
  await saveHomeSnapshot(A, { wallet: WALLET, progress: PROGRESS }, { at: NOW })
  assert.equal(await disableOfflineAccess(), true)
  const keys = (await rawAll('syncMeta')).map((row) => row.key)
  assert.equal(keys.includes(homeSnapshotKey(A)), false)
  assert.deepEqual(await readOfflineEntry(), { record: null, home: null, rollout: null })
})

test('gravação que termina DEPOIS do logout da mesma conta é descartada (o dado de quem saiu não volta)', async () => {
  await saveBootstrap(bootstrapOf(A))
  const arrivedBeforeLogout = Date.now() - 1000
  await disableOfflineAccess()
  assert.equal(await saveHomeSnapshot(A, { wallet: WALLET }, { at: arrivedBeforeLogout }), false)
  assert.equal((await rawAll('syncMeta')).some((r) => r.key === homeSnapshotKey(A)), false)
  // Um dado que chegou DEPOIS do logout (novo login online) volta a ser gravado.
  assert.equal(await saveHomeSnapshot(A, { wallet: WALLET }, { at: Date.now() + 1000 }), true)
})

test('troca de identidade: dropBootstrapsExcept leva junto o snapshot das contas que ficaram para trás', async () => {
  await saveBootstrap(bootstrapOf(A))
  await saveHomeSnapshot(A, { wallet: WALLET }, { at: NOW })
  await saveHomeSnapshot(B, { wallet: WALLET }, { at: NOW })
  await dropBootstrapsExcept(B)
  const keys = (await rawAll('syncMeta')).map((row) => row.key)
  assert.equal(keys.includes(homeSnapshotKey(A)), false)
  assert.equal(keys.includes(homeSnapshotKey(B)), true)
})

test('limpeza de cache privado (logout/troca) também remove snapshots; só o do usuário que fica sobrevive', async () => {
  await saveHomeSnapshot(A, { wallet: WALLET }, { at: NOW })
  await saveHomeSnapshot(B, { wallet: WALLET }, { at: NOW })
  await purgePrivateData(B)
  let keys = (await rawAll('syncMeta')).map((row) => row.key)
  assert.deepEqual(keys.filter((k) => k.startsWith('user:')), [homeSnapshotKey(B)])
  await purgePrivateData(null)
  keys = (await rawAll('syncMeta')).map((row) => row.key)
  assert.deepEqual(keys.filter((k) => k.startsWith('user:')), [])
})
