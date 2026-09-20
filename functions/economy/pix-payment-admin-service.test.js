import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createPixPaymentAdminService } from './pix-payment-admin-service.js'
import { createWalletService } from './wallet-service.js'
import { createLedgerService } from './ledger-service.js'
import { createCashPurchaseService } from './cash-purchase-service.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
initializeApp({ projectId: 'demo-treinos-pix-admin-test' })
const db = getFirestore()

// privatePaymentConfig/pix e economyConfig/current são documentos ÚNICOS (não têm um ID
// gerado por teste, ao contrário de users/{uid} ou cashPurchases/{purchaseId}) -- sem
// isso, testes rodando em sequência no mesmo projeto do emulador contaminariam uns aos
// outros (métodos de um teste "vazando" pro próximo).
beforeEach(async () => {
  await db.doc('privatePaymentConfig/pix').delete()
  await db.doc('economyConfig/current').delete()
})

function FakeHttpsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

let counter = 0
function uid() {
  return `u-${Date.now()}-${counter++}`
}
function requestId() {
  return `req-${Date.now()}-${counter++}`
}

function buildAdminService() {
  return createPixPaymentAdminService({ db, FieldValue, HttpsError: FakeHttpsError })
}

async function makeSuperAdmin() {
  const id = uid()
  await db.doc(`users/${id}`).set({ role: 'superadmin' })
  return id
}
async function makeRegularUser() {
  const id = uid()
  await db.doc(`users/${id}`).set({ role: 'user' })
  return id
}

async function getEconomyConfig() {
  const snapshot = await db.doc('economyConfig/current').get()
  return snapshot.exists ? snapshot.data() : null
}

// economyConfig/current SEMPRE existe em produção (cashPackages já configurado antes de
// qualquer admin mexer em PIX) -- update() (usado pra publicar pixPayment, ver
// pix-payment-admin-service.js) exige que o documento já exista, ao contrário de
// set(...,{merge:true}). Testes que ativam uma chave ou mudam o toggle global precisam
// simular essa precondição real.
async function seedEconomyConfigExists(overrides = {}) {
  await db.doc('economyConfig/current').set(overrides)
}

const FIELDS_A = { label: 'Conta principal', key: 'chave-a@evolutus.app', keyType: 'email', recipientName: 'Evolutus Ltda' }
const FIELDS_B = { label: 'Conta backup', key: '11987654321', keyType: 'phone', recipientName: 'Daniel Alves Lira' }

test('superadmin cadastra uma nova chave PIX', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  const result = await service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A })

  assert.match(result.id, /^pix_/)
  assert.equal(result.key, FIELDS_A.key)
  assert.equal(result.keyType, FIELDS_A.keyType)
  assert.equal(result.recipientName, FIELDS_A.recipientName)
  assert.equal(result.label, FIELDS_A.label)
  assert.ok(result.createdAt)
  assert.ok(result.updatedAt)

  const { methods } = await service.listPixPaymentMethods(admin)
  assert.equal(methods.length, 1)
  assert.equal(methods[0].id, result.id)
})

test('usuário comum não consegue cadastrar/listar chaves PIX', async () => {
  const service = buildAdminService()
  const notAdmin = await makeRegularUser()
  await assert.rejects(
    () => service.savePixPaymentMethod(notAdmin, { methodId: null, ...FIELDS_A }),
    (error) => error.code === 'permission-denied'
  )
  await assert.rejects(
    () => service.listPixPaymentMethods(notAdmin),
    (error) => error.code === 'permission-denied'
  )
})

test('savePixPaymentMethod rejeita campos inválidos antes de gravar qualquer coisa', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  await assert.rejects(
    () => service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A, label: '' }),
    (error) => error.code === 'invalid-argument'
  )
  await assert.rejects(
    () => service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A, keyType: 'bitcoin' }),
    (error) => error.code === 'invalid-argument'
  )
  const { methods } = await service.listPixPaymentMethods(admin)
  assert.equal(methods.length, 0, 'nada foi gravado')
})

test('superadmin edita uma chave já existente (preserva createdAt, atualiza o resto)', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  const created = await service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A })
  // created.createdAt ainda é o sentinel FieldValue.serverTimestamp() (não resolvido) --
  // relê pra comparar contra o Timestamp real que o Firestore já gravou.
  const originalCreatedAt = (await service.listPixPaymentMethods(admin)).methods[0].createdAt

  const edited = await service.savePixPaymentMethod(admin, {
    methodId: created.id,
    label: 'Conta principal (editada)',
    key: 'nova-chave@evolutus.app',
    keyType: 'email',
    recipientName: FIELDS_A.recipientName,
  })

  assert.equal(edited.id, created.id, 'edição nunca cria um ID novo')
  assert.equal(edited.key, 'nova-chave@evolutus.app')
  assert.deepEqual(edited.createdAt, originalCreatedAt, 'createdAt preservado')

  const { methods } = await service.listPixPaymentMethods(admin)
  assert.equal(methods.length, 1, 'edição nunca duplica a chave')
})

test('ativar uma chave SEM habilitar os pagamentos publica só {enabled:false} -- nunca vaza a chave antes de habilitar', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  await seedEconomyConfigExists()
  const methodA = await service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A })

  await service.setActivePixPaymentMethod(admin, { methodId: methodA.id })

  const config = await getEconomyConfig()
  assert.deepEqual(config.pixPayment, { enabled: false })
})

// Sequência completa pedida explicitamente: ativar A (habilitado) -> só A; ativar B ->
// nenhum resíduo de A; desativar -> só {enabled:false}; privatePaymentConfig continua
// com A e B intactos o tempo todo; cashPackages/promotionPackages nunca mudam.
test('sequência completa: ativar A habilitado publica só A, trocar para B não deixa resíduo de A, desativar publica só enabled:false', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  const fixedConfig = {
    cashPackages: { pack_100: { cashAmount: 100, amountCentavos: 990, label: '100 EvoCash', active: true } },
    promotionPackages: { post_boost_3d: { cashAmount: 25, durationDays: 3, active: true, targetType: 'post', label: 'Destaque 3 dias' } },
  }
  await seedEconomyConfigExists(fixedConfig)

  const methodA = await service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A })
  const methodB = await service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_B })

  // 1. ativar A + habilitar -> projeção contém SOMENTE A.
  await service.setActivePixPaymentMethod(admin, { methodId: methodA.id })
  await service.setPixPaymentsEnabled(admin, { enabled: true })
  let config = await getEconomyConfig()
  assert.deepEqual(config.pixPayment, {
    enabled: true,
    key: FIELDS_A.key,
    keyType: FIELDS_A.keyType,
    recipientName: FIELDS_A.recipientName,
  })
  assert.deepEqual(Object.keys(config.pixPayment).sort(), ['enabled', 'key', 'keyType', 'recipientName'])

  // 2. ativar B -> nenhum campo/valor residual de A sobrevive.
  await service.setActivePixPaymentMethod(admin, { methodId: methodB.id })
  config = await getEconomyConfig()
  assert.deepEqual(config.pixPayment, {
    enabled: true,
    key: FIELDS_B.key,
    keyType: FIELDS_B.keyType,
    recipientName: FIELDS_B.recipientName,
  })
  assert.deepEqual(Object.keys(config.pixPayment).sort(), ['enabled', 'key', 'keyType', 'recipientName'])
  assert.equal(JSON.stringify(config.pixPayment).includes(FIELDS_A.key), false, 'chave A não sobrevive')
  assert.equal(JSON.stringify(config.pixPayment).includes(FIELDS_A.recipientName), false, 'recebedor A não sobrevive')

  // 3. desativar -> projeção contém SOMENTE enabled:false, nada da chave B.
  await service.setPixPaymentsEnabled(admin, { enabled: false })
  config = await getEconomyConfig()
  assert.deepEqual(config.pixPayment, { enabled: false })
  assert.deepEqual(Object.keys(config.pixPayment), ['enabled'])

  // privatePaymentConfig continua com A e B normalmente -- desativar/trocar nunca apaga
  // as chaves cadastradas, só a projeção pública muda.
  const { methods } = await service.listPixPaymentMethods(admin)
  assert.deepEqual(methods.map((m) => m.id).sort(), [methodA.id, methodB.id].sort())
  const persistedMethodA = methods.find((m) => m.id === methodA.id)
  assert.equal(persistedMethodA.key, FIELDS_A.key)
  assert.equal(persistedMethodA.keyType, FIELDS_A.keyType)
  assert.equal(persistedMethodA.recipientName, FIELDS_A.recipientName)
  assert.equal(persistedMethodA.label, FIELDS_A.label)

  // cashPackages/promotionPackages nunca mudaram durante toda a sequência.
  assert.deepEqual(config.cashPackages, fixedConfig.cashPackages)
  assert.deepEqual(config.promotionPackages, fixedConfig.promotionPackages)
})

test('ativar uma chave inexistente falha, sem publicar nada', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  await assert.rejects(
    () => service.setActivePixPaymentMethod(admin, { methodId: 'pix_nao_existe' }),
    (error) => error.code === 'not-found'
  )
  assert.equal(await getEconomyConfig(), null)
})

test('trocar a chave ativa de A para B: novos pedidos passam a usar B, o pending já existente com A não muda', async () => {
  const adminService = buildAdminService()
  const wallet = createWalletService({ db, FieldValue })
  const ledger = createLedgerService({ db, FieldValue })
  const cashPurchases = createCashPurchaseService({
    db,
    FieldValue,
    wallet,
    ledger,
    assertWritableAccount: async () => {},
    HttpsError: FakeHttpsError,
  })
  const admin = await makeSuperAdmin()
  const buyer = uid()
  await db.doc('economyConfig/current').set(
    { cashPackages: { pack_100: { cashAmount: 100, amountCentavos: 990, label: '100 EvoCash', active: true } } },
    { merge: true }
  )

  const methodA = await adminService.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A })
  await adminService.setActivePixPaymentMethod(admin, { methodId: methodA.id })
  await adminService.setPixPaymentsEnabled(admin, { enabled: true })

  // pedido criado enquanto A está ativa -- snapshot grava A.
  const oldPurchase = await cashPurchases.requestCashPurchase(buyer, {
    packageId: 'pack_100',
    requestId: requestId(),
  })
  assert.deepEqual(oldPurchase.pixPaymentSnapshot, { key: FIELDS_A.key, keyType: FIELDS_A.keyType, recipientName: FIELDS_A.recipientName })

  // admin troca a chave ativa para B.
  const methodB = await adminService.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_B })
  await adminService.setActivePixPaymentMethod(admin, { methodId: methodB.id })

  const configAfterSwitch = await getEconomyConfig()
  assert.deepEqual(configAfterSwitch.pixPayment, { enabled: true, key: FIELDS_B.key, keyType: FIELDS_B.keyType, recipientName: FIELDS_B.recipientName })

  // reler o pedido antigo (simulando reload de "Minhas compras") -- continua com A.
  const oldPurchaseReloaded = await db.doc(`cashPurchases/${oldPurchase.purchaseId}`).get()
  assert.deepEqual(oldPurchaseReloaded.data().pixPaymentSnapshot, {
    key: FIELDS_A.key,
    keyType: FIELDS_A.keyType,
    recipientName: FIELDS_A.recipientName,
  })

  // um pedido NOVO, criado agora, usa B.
  const newPurchase = await cashPurchases.requestCashPurchase(uid(), {
    packageId: 'pack_100',
    requestId: requestId(),
  })
  assert.deepEqual(newPurchase.pixPaymentSnapshot, { key: FIELDS_B.key, keyType: FIELDS_B.keyType, recipientName: FIELDS_B.recipientName })
})

test('desativar os pagamentos PIX bloqueia novas compras (requestCashPurchase fail-closed)', async () => {
  const adminService = buildAdminService()
  const wallet = createWalletService({ db, FieldValue })
  const ledger = createLedgerService({ db, FieldValue })
  const cashPurchases = createCashPurchaseService({
    db,
    FieldValue,
    wallet,
    ledger,
    assertWritableAccount: async () => {},
    HttpsError: FakeHttpsError,
  })
  const admin = await makeSuperAdmin()
  await db.doc('economyConfig/current').set(
    { cashPackages: { pack_100: { cashAmount: 100, amountCentavos: 990, label: '100 EvoCash', active: true } } },
    { merge: true }
  )
  const method = await adminService.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A })
  await adminService.setActivePixPaymentMethod(admin, { methodId: method.id })
  await adminService.setPixPaymentsEnabled(admin, { enabled: true })

  // confirma que estava habilitado antes de desativar.
  await cashPurchases.requestCashPurchase(uid(), { packageId: 'pack_100', requestId: requestId() })

  await adminService.setPixPaymentsEnabled(admin, { enabled: false })
  const config = await getEconomyConfig()
  assert.equal(config.pixPayment.enabled, false)

  await assert.rejects(
    () => cashPurchases.requestCashPurchase(uid(), { packageId: 'pack_100', requestId: requestId() }),
    (error) => error.code === 'failed-precondition' && /PIX estão temporariamente indisponíveis/.test(error.message)
  )
})

test('habilitar pagamentos sem nenhuma chave ativa selecionada falha', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  await assert.rejects(
    () => service.setPixPaymentsEnabled(admin, { enabled: true }),
    (error) => error.code === 'failed-precondition'
  )
})

test('excluir a chave ativa é bloqueado -- é preciso ativar outra primeiro', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  await seedEconomyConfigExists()
  const methodA = await service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A })
  await service.setActivePixPaymentMethod(admin, { methodId: methodA.id })

  await assert.rejects(
    () => service.deletePixPaymentMethod(admin, { methodId: methodA.id }),
    (error) => error.code === 'failed-precondition'
  )
  const { methods } = await service.listPixPaymentMethods(admin)
  assert.equal(methods.length, 1, 'a chave ativa continua cadastrada')
})

test('excluir uma chave NÃO ativa funciona normalmente', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  await seedEconomyConfigExists()
  const methodA = await service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A })
  const methodB = await service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_B })
  await service.setActivePixPaymentMethod(admin, { methodId: methodA.id })

  await service.deletePixPaymentMethod(admin, { methodId: methodB.id })
  const { methods } = await service.listPixPaymentMethods(admin)
  assert.deepEqual(methods.map((m) => m.id), [methodA.id])
})

test('excluir uma chave inexistente falha', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  await assert.rejects(
    () => service.deletePixPaymentMethod(admin, { methodId: 'pix_nao_existe' }),
    (error) => error.code === 'not-found'
  )
})

test('nenhuma operação de administração de PIX altera cashPackages/promotionPackages', async () => {
  const service = buildAdminService()
  const admin = await makeSuperAdmin()
  const fixedConfig = {
    cashPackages: { pack_100: { cashAmount: 100, amountCentavos: 990, label: '100 EvoCash', active: true } },
    promotionPackages: { post_boost_3d: { cashAmount: 25, durationDays: 3, active: true, targetType: 'post', label: 'Destaque 3 dias' } },
  }
  await db.doc('economyConfig/current').set(fixedConfig, { merge: true })

  const method = await service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_A })
  await service.setActivePixPaymentMethod(admin, { methodId: method.id })
  await service.setPixPaymentsEnabled(admin, { enabled: true })
  await service.savePixPaymentMethod(admin, { methodId: method.id, ...FIELDS_A, label: 'Editada' })
  const methodB = await service.savePixPaymentMethod(admin, { methodId: null, ...FIELDS_B })
  await service.deletePixPaymentMethod(admin, { methodId: methodB.id })
  await service.setPixPaymentsEnabled(admin, { enabled: false })

  const config = await getEconomyConfig()
  assert.deepEqual(config.cashPackages, fixedConfig.cashPackages)
  assert.deepEqual(config.promotionPackages, fixedConfig.promotionPackages)
})
