import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createWalletService } from './wallet-service.js'
import { createLedgerService } from './ledger-service.js'
import { createCashPurchaseService } from './cash-purchase-service.js'
import { cashPurchaseIdFromRequest } from './cash-purchase-core.js'
import { createDeletionService } from '../deletion-service.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
// Projeto próprio, mesmo raciocínio de reward-settlement-service.test.js: evita
// contaminação cruzada de outros arquivos de teste rodando em paralelo contra o mesmo
// projeto do emulador.
initializeApp({ projectId: 'demo-treinos-cash-purchase-test' })
const db = getFirestore()

function FakeHttpsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

async function assertWritableAccount(tx, testUid) {
  if ((await tx.get(db.doc(`deletionJobs/account_${testUid}`))).exists) {
    throw new FakeHttpsError('failed-precondition', 'A conta está em exclusão.')
  }
}

const fakeAuth = {
  async updateUser() {},
  async revokeRefreshTokens() {},
  async deleteUser() {},
}
const fakeBucket = { file: () => ({ delete: async () => {} }) }

let counter = 0
function uid() {
  return `u-${Date.now()}-${counter++}`
}
function requestId() {
  return `req-${Date.now()}-${counter++}`
}

function buildService() {
  const wallet = createWalletService({ db, FieldValue })
  const ledger = createLedgerService({ db, FieldValue })
  return createCashPurchaseService({
    db,
    FieldValue,
    wallet,
    ledger,
    assertWritableAccount,
    HttpsError: FakeHttpsError,
  })
}

function buildDeletions() {
  return createDeletionService({
    db,
    auth: fakeAuth,
    bucket: fakeBucket,
    FieldValue,
    Timestamp,
    HttpsError: FakeHttpsError,
  })
}

const PACKAGE_ID = 'pack_100'
const PACKAGE = { cashAmount: 100, amountCentavos: 990, label: '100 EvoCash', active: true }
const VALID_PIX_PAYMENT = {
  enabled: true,
  key: 'chave-pix-teste@evolutus.app',
  keyType: 'email',
  recipientName: 'Evolutus Ltda',
}

// pixPayment sempre vem válido por padrão -- os testes que existiam antes desta função
// aceitar um 2º parâmetro continuam batendo o caminho feliz sem precisar saber que o
// PIX agora também é validado. Testes que querem um pixPayment especificamente inválido
// passam { pixPayment: {...} }; o cenário de "documento sem pixPayment nenhum" precisa
// escrever direto (default de parâmetro dispara mesmo passando `undefined` explícito).
async function seedConfig(cashPackageOverrides = {}, { pixPayment = VALID_PIX_PAYMENT } = {}) {
  await db.doc('economyConfig/current').set({
    version: 7,
    cashPackages: { [PACKAGE_ID]: PACKAGE, ...cashPackageOverrides },
    pixPayment,
  })
}

async function getWallet(userId) {
  const snapshot = await db.doc(`users/${userId}/wallet/current`).get()
  return snapshot.exists ? snapshot.data() : null
}
async function getLock(userId) {
  const snapshot = await db.doc(`users/${userId}/wallet/cashPurchaseLock`).get()
  return snapshot.exists ? snapshot.data() : null
}
async function getPurchase(purchaseId) {
  const snapshot = await db.doc(`cashPurchases/${purchaseId}`).get()
  return snapshot.exists ? snapshot.data() : null
}
async function countLedgerEntries(userId) {
  const snapshot = await db.collection(`users/${userId}/economyTransactions`).get()
  return snapshot.size
}

test('requestCashPurchase cria um pedido pending com snapshot imutável do pacote/preço', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const result = await service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() })

  assert.equal(result.status, 'pending')
  assert.equal(result.cashAmount, PACKAGE.cashAmount)
  assert.equal(result.amountCentavos, PACKAGE.amountCentavos)
  assert.equal(result.currency, 'BRL')
  assert.equal(result.packageLabel, PACKAGE.label)

  const purchase = await getPurchase(result.purchaseId)
  assert.equal(purchase.userId, buyer)
  assert.equal(purchase.packageId, PACKAGE_ID)
  assert.equal(purchase.paymentMethod, 'manual_pix')
  assert.equal(purchase.configVersion, 7)
  assert.ok(purchase.createdAt)

  const lock = await getLock(buyer)
  assert.equal(lock.pendingPurchaseId, result.purchaseId)
})

// Regressão de produção: economyConfig/current criado só com cashPackages (sem
// `version`) fazia tx.create falhar com "Cannot use undefined as a Firestore value
// (found in field configVersion)" -- toda compra retornava 500. seedConfig() sempre
// setava version:7 no fixture, então esse gap nunca apareceu em teste antes de acontecer
// de verdade em produção (ver auditoria dos logs do requestCashPurchase).
test('requestCashPurchase nunca falha por causa de economyConfig/current sem "version" -- configVersion vira null', async () => {
  const service = buildService()
  await db.doc('economyConfig/current').set({ cashPackages: { [PACKAGE_ID]: PACKAGE }, pixPayment: VALID_PIX_PAYMENT })
  const buyer = uid()
  const result = await service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() })

  assert.equal(result.status, 'pending')
  const purchase = await getPurchase(result.purchaseId)
  assert.equal(purchase.configVersion, null)
})

test('requestCashPurchase trata um "version" inválido/corrompido como null, nunca grava lixo nem quebra', async () => {
  const service = buildService()
  await db.doc('economyConfig/current').set({
    version: 'not-a-number',
    cashPackages: { [PACKAGE_ID]: PACKAGE },
    pixPayment: VALID_PIX_PAYMENT,
  })
  const buyer = uid()
  const result = await service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() })

  assert.equal(result.status, 'pending')
  const purchase = await getPurchase(result.purchaseId)
  assert.equal(purchase.configVersion, null)
})

test('cliente não define preço nem quantidade -- só packageId é usado, o resto vem sempre do servidor', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  // Um cliente malicioso/bugado passando cashAmount/amountCentavos junto não muda nada:
  // a função nem lê esses campos da entrada.
  const result = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
    cashAmount: 999999,
    amountCentavos: 1,
  })
  assert.equal(result.cashAmount, PACKAGE.cashAmount)
  assert.equal(result.amountCentavos, PACKAGE.amountCentavos)
})

// ---- pixPaymentSnapshot: mesmo raciocínio de imutabilidade do snapshot financeiro ----

test('requestCashPurchase salva pixPaymentSnapshot vindo da config no momento da criação, e devolve no payload', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const result = await service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() })

  const expectedSnapshot = {
    key: VALID_PIX_PAYMENT.key,
    keyType: VALID_PIX_PAYMENT.keyType,
    recipientName: VALID_PIX_PAYMENT.recipientName,
  }
  assert.deepEqual(result.pixPaymentSnapshot, expectedSnapshot)
  const purchase = await getPurchase(result.purchaseId)
  assert.deepEqual(purchase.pixPaymentSnapshot, expectedSnapshot)
})

test('payload do cliente não consegue sobrescrever pixPaymentSnapshot -- só a config lida pelo servidor conta', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  // Cliente malicioso/bugado tentando injetar um destino de PIX diferente junto do
  // pedido -- requestCashPurchase nem lê esse campo da entrada.
  const result = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
    pixPaymentSnapshot: { key: 'chave-do-atacante@evil.com', keyType: 'email', recipientName: 'Atacante' },
  })
  assert.deepEqual(result.pixPaymentSnapshot, {
    key: VALID_PIX_PAYMENT.key,
    keyType: VALID_PIX_PAYMENT.keyType,
    recipientName: VALID_PIX_PAYMENT.recipientName,
  })
})

test('mudar economyConfig/current.pixPayment depois não altera o pixPaymentSnapshot de um pending já existente (reload lê o snapshot do próprio pedido)', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })

  // Config muda -- nova chave/recebedor, como se o dono tivesse trocado o PIX depois.
  await seedConfig(
    {},
    { pixPayment: { enabled: true, key: 'chave-nova@evolutus.app', keyType: 'email', recipientName: 'Novo Recebedor' } }
  )

  // "Reload": relê o pedido já existente diretamente, independente do resultado
  // original de requestCashPurchase -- simula abrir "Minhas compras" de novo.
  const purchaseAfterConfigChange = await getPurchase(purchaseId)
  assert.deepEqual(purchaseAfterConfigChange.pixPaymentSnapshot, {
    key: VALID_PIX_PAYMENT.key,
    keyType: VALID_PIX_PAYMENT.keyType,
    recipientName: VALID_PIX_PAYMENT.recipientName,
  })
})

test('config ausente bloqueia a compra (fail-closed, sem fallback)', async () => {
  const service = buildService()
  await db.doc('economyConfig/current').delete()
  const buyer = uid()
  await assert.rejects(
    () => service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() }),
    (error) => error.code === 'failed-precondition'
  )
})

test('pacote malformado na config bloqueia a compra', async () => {
  const service = buildService()
  await seedConfig({ [PACKAGE_ID]: { cashAmount: -5, amountCentavos: 990, label: 'x' } })
  const buyer = uid()
  await assert.rejects(
    () => service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() }),
    (error) => error.code === 'failed-precondition'
  )
})

test('pacote inativo (active:false) bloqueia com mensagem própria, distinta de config inválida', async () => {
  const service = buildService()
  await seedConfig({ [PACKAGE_ID]: { ...PACKAGE, active: false } })
  const buyer = uid()
  await assert.rejects(
    () => service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() }),
    (error) => error.code === 'failed-precondition' && /não está mais disponível/.test(error.message)
  )
})

// ---- fail-closed também pro PIX: sem pixPayment válido, nem cria o pedido ----

test('pixPayment válido permite a criação do pedido normalmente', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const result = await service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() })
  assert.equal(result.status, 'pending')
})

test('pixPayment.enabled !== true bloqueia a criação do pedido, sem nenhuma escrita parcial', async () => {
  const service = buildService()
  await seedConfig({}, { pixPayment: { ...VALID_PIX_PAYMENT, enabled: false } })
  const buyer = uid()
  await assert.rejects(
    () => service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() }),
    (error) => error.code === 'failed-precondition' && /PIX estão temporariamente indisponíveis/.test(error.message)
  )
  const snapshot = await db.collection('cashPurchases').where('userId', '==', buyer).get()
  assert.equal(snapshot.size, 0, 'nenhum cashPurchases criado')
  assert.equal(await getLock(buyer), null, 'nenhum lock criado')
})

test('pixPayment ausente do documento inteiro bloqueia a criação do pedido', async () => {
  const service = buildService()
  // Direto (não via seedConfig): default de parâmetro dispara mesmo passando
  // `pixPayment: undefined` explicitamente, então só escrever o doc sem o campo garante
  // o cenário real de "nunca foi configurado".
  await db.doc('economyConfig/current').set({ version: 7, cashPackages: { [PACKAGE_ID]: PACKAGE } })
  const buyer = uid()
  await assert.rejects(
    () => service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() }),
    (error) => error.code === 'failed-precondition' && /PIX estão temporariamente indisponíveis/.test(error.message)
  )
  const snapshot = await db.collection('cashPurchases').where('userId', '==', buyer).get()
  assert.equal(snapshot.size, 0)
})

test('chave PIX ausente/vazia bloqueia a criação do pedido, sem nenhuma escrita parcial', async () => {
  const service = buildService()
  await seedConfig({}, { pixPayment: { ...VALID_PIX_PAYMENT, key: '' } })
  const buyer = uid()
  await assert.rejects(
    () => service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() }),
    (error) => error.code === 'failed-precondition' && /PIX estão temporariamente indisponíveis/.test(error.message)
  )
  assert.equal(await getLock(buyer), null)
})

test('recipientName ausente bloqueia a criação do pedido, sem nenhuma escrita parcial', async () => {
  const service = buildService()
  const { recipientName, ...withoutRecipient } = VALID_PIX_PAYMENT
  void recipientName
  await seedConfig({}, { pixPayment: withoutRecipient })
  const buyer = uid()
  await assert.rejects(
    () => service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() }),
    (error) => error.code === 'failed-precondition' && /PIX estão temporariamente indisponíveis/.test(error.message)
  )
  const snapshot = await db.collection('cashPurchases').where('userId', '==', buyer).get()
  assert.equal(snapshot.size, 0)
  assert.equal(await getLock(buyer), null)
})

test('mesmo requestId + mesmo packageId -> replay: devolve o mesmo pedido, não cria um segundo documento', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const rid = requestId()
  const first = await service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: rid })
  const second = await service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: rid })

  assert.equal(second.purchaseId, first.purchaseId)
  const snapshot = await db.collection('cashPurchases').where('userId', '==', buyer).get()
  assert.equal(snapshot.size, 1, 'nunca duas intenções idênticas')
})

test('mesmo requestId + packageId diferente -> conflito, nunca devolve silenciosamente a compra antiga', async () => {
  const service = buildService()
  await seedConfig({ pack_550: { cashAmount: 550, amountCentavos: 4990, label: '550 EvoCash', active: true } })
  const buyer = uid()
  const rid = requestId()
  await service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: rid })
  await assert.rejects(
    () => service.requestCashPurchase(buyer, { packageId: 'pack_550', requestId: rid }),
    (error) => error.code === 'already-exists'
  )
})

test('lock: uma segunda compra pending do mesmo usuário é bloqueada de forma determinística (não por query)', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  await service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() })
  await assert.rejects(
    () => service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() }),
    (error) => error.code === 'failed-precondition'
  )
})

test('lock inconsistente (pendingPurchaseId aponta para compra já resolvida) ainda assim não permite um segundo pending -- fail-safe, não fail-open', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  // Simula uma inconsistência (bug/edição manual): lock apontando para um purchaseId
  // que nem existe mais como pending -- a checagem é deliberadamente "burra" (só olha o
  // campo), nunca confirma o estado real da compra referenciada.
  await db.doc(`users/${buyer}/wallet/cashPurchaseLock`).set({ pendingPurchaseId: 'purchase-inexistente' })
  await assert.rejects(
    () => service.requestCashPurchase(buyer, { packageId: PACKAGE_ID, requestId: requestId() }),
    (error) => error.code === 'failed-precondition'
  )
})

test('lock inconsistente COM o purchase sendo confirmado (aponta para outra compra) -- confirm ainda credita corretamente e não mexe no lock alheio', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })
  // Desincroniza deliberadamente o lock -- simula um purchaseId "de outra compra"
  // (só alcançável via edição manual, nunca pela API real, já que requestCashPurchase
  // sempre escreve compra+lock juntos na mesma transação).
  await db.doc(`users/${buyer}/wallet/cashPurchaseLock`).set({ pendingPurchaseId: 'outra-compra-qualquer' })

  await service.confirmCashPurchase(admin, purchaseId)

  const wallet = await getWallet(buyer)
  assert.equal(wallet.cashBalance, PACKAGE.cashAmount, 'credita normalmente mesmo com o lock desincronizado')
  const lock = await getLock(buyer)
  assert.equal(
    lock.pendingPurchaseId,
    'outra-compra-qualquer',
    'nunca limpa um lock que não corresponde à compra confirmada -- fail-closed, não mexe no que não é seu'
  )
})

test('confirmCashPurchase revalida defensivamente o snapshot antes de creditar -- um documento corrompido (edição manual) nunca é creditado', async () => {
  const service = buildService()
  const buyer = uid()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  // Simula uma compra 'pending' com snapshot corrompido -- nunca alcançável via
  // requestCashPurchase (que só grava depois de isValidCashPackage passar), só via
  // edição manual/migração futura. ID único por execução (não 'a'.repeat(64) fixo, que
  // colidiria com o purchaseId usado pelo teste "confirmar compra inexistente falha").
  const purchaseId = cashPurchaseIdFromRequest(buyer, requestId())
  await db.doc(`cashPurchases/${purchaseId}`).set({
    userId: buyer,
    packageId: PACKAGE_ID,
    packageLabel: '100 EvoCash',
    cashAmount: -50, // corrompido
    amountCentavos: 990,
    currency: 'BRL',
    paymentMethod: 'manual_pix',
    status: 'pending',
  })

  await assert.rejects(
    () => service.confirmCashPurchase(admin, purchaseId),
    (error) => error.code === 'failed-precondition' && /inconsistente/.test(error.message)
  )
  assert.equal(await getWallet(buyer), null, 'nada foi creditado')
  assert.equal((await getPurchase(purchaseId)).status, 'pending', 'compra corrompida não avança de estado sozinha')
})

test('confirmCashPurchase aceita adminNote opcional para auditoria de PIX manual, sem alterar o snapshot financeiro', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })

  await service.confirmCashPurchase(admin, purchaseId, 'PIX recebido, comprovante #12345')

  const purchase = await getPurchase(purchaseId)
  assert.equal(purchase.confirmationNote, 'PIX recebido, comprovante #12345')
  // snapshot financeiro continua intacto -- a nota nunca compartilha caminho de escrita
  // com cashAmount/amountCentavos/currency.
  assert.equal(purchase.cashAmount, PACKAGE.cashAmount)
  assert.equal(purchase.amountCentavos, PACKAGE.amountCentavos)
  assert.equal(purchase.currency, 'BRL')
  const wallet = await getWallet(buyer)
  assert.equal(wallet.cashBalance, PACKAGE.cashAmount)
})

test('confirmCashPurchase rejeita adminNote absurdamente longa', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })
  await assert.rejects(
    () => service.confirmCashPurchase(admin, purchaseId, 'x'.repeat(501)),
    (error) => error.code === 'invalid-argument'
  )
})

test('confirmCashPurchase credita wallet+ledger+status atomicamente e libera o lock', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })

  const result = await service.confirmCashPurchase(admin, purchaseId)
  assert.equal(result.cashAmount, PACKAGE.cashAmount)

  const wallet = await getWallet(buyer)
  assert.equal(wallet.cashBalance, PACKAGE.cashAmount)
  assert.equal(wallet.coinBalance, 0, 'EvoCash nunca mistura com EvoCoins')

  const purchase = await getPurchase(purchaseId)
  assert.equal(purchase.status, 'credited')
  assert.equal(purchase.creditedBy, admin)
  assert.ok(purchase.creditedAt)
  // snapshot financeiro intacto -- só status e metadados de transição mudaram
  assert.equal(purchase.packageId, PACKAGE_ID)
  assert.equal(purchase.cashAmount, PACKAGE.cashAmount)
  assert.equal(purchase.amountCentavos, PACKAGE.amountCentavos)
  assert.equal(purchase.currency, 'BRL')
  assert.equal(purchase.packageLabel, PACKAGE.label)

  assert.equal(await countLedgerEntries(buyer), 1)
  const lock = await getLock(buyer)
  assert.equal(lock.pendingPurchaseId, null, 'lock liberado após confirmação')
})

test('confirmação dupla (duas chamadas concorrentes) nunca credita duas vezes', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })

  const results = await Promise.allSettled([
    service.confirmCashPurchase(admin, purchaseId),
    service.confirmCashPurchase(admin, purchaseId),
  ])
  const succeeded = results.filter((r) => r.status === 'fulfilled')
  assert.equal(succeeded.length, 1, 'só uma das duas pode ter vencido')

  const wallet = await getWallet(buyer)
  assert.equal(wallet.cashBalance, PACKAGE.cashAmount, 'crédito único, não duplicado')
  assert.equal(await countLedgerEntries(buyer), 1)
})

test('confirmar uma compra já cancelada falha', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })
  await service.cancelCashPurchase(admin, purchaseId, 'usuário desistiu')
  await assert.rejects(
    () => service.confirmCashPurchase(admin, purchaseId),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal(await getWallet(buyer), null)
})

test('confirmar compra inexistente falha', async () => {
  const service = buildService()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  await assert.rejects(
    () => service.confirmCashPurchase(admin, 'a'.repeat(64)),
    (error) => error.code === 'not-found'
  )
})

test('confirmar por não-admin falha, sem nenhum efeito colateral', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const notAdmin = uid()
  await db.doc(`users/${notAdmin}`).set({ role: 'user' })
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })
  await assert.rejects(
    () => service.confirmCashPurchase(notAdmin, purchaseId),
    (error) => error.code === 'permission-denied'
  )
  assert.equal(await getWallet(buyer), null)
  assert.equal((await getPurchase(purchaseId)).status, 'pending')
})

test('cancelCashPurchase exige motivo, só funciona em pending, e não reverte nada (nada foi creditado)', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })

  await assert.rejects(
    () => service.cancelCashPurchase(admin, purchaseId, 'oi'),
    (error) => error.code === 'invalid-argument',
    'motivo curto demais'
  )

  await service.cancelCashPurchase(admin, purchaseId, 'usuário pediu reembolso antes do pagamento')
  const purchase = await getPurchase(purchaseId)
  assert.equal(purchase.status, 'cancelled')
  assert.equal(purchase.cancelledBy, admin)
  assert.ok(purchase.cancelReason)
  assert.equal(await getWallet(buyer), null)
  assert.equal(await countLedgerEntries(buyer), 0)

  const lock = await getLock(buyer)
  assert.equal(lock.pendingPurchaseId, null)
})

test('cancelar uma compra já credited falha (não reverte crédito já dado)', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })
  await service.confirmCashPurchase(admin, purchaseId)
  await assert.rejects(
    () => service.cancelCashPurchase(admin, purchaseId, 'tentativa de reverter'),
    (error) => error.code === 'failed-precondition'
  )
  const wallet = await getWallet(buyer)
  assert.equal(wallet.cashBalance, PACKAGE.cashAmount, 'crédito já dado permanece intacto')
})

test('cancelar por não-admin falha', async () => {
  const service = buildService()
  await seedConfig()
  const buyer = uid()
  const notAdmin = uid()
  await db.doc(`users/${notAdmin}`).set({ role: 'user' })
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })
  await assert.rejects(
    () => service.cancelCashPurchase(notAdmin, purchaseId, 'motivo qualquer aqui'),
    (error) => error.code === 'permission-denied'
  )
  assert.equal((await getPurchase(purchaseId)).status, 'pending')
})

// ---- integração com o portão financeiro da exclusão de conta ----

test('admin confirma compra enquanto a exclusão está blocked_financial_review -- permitido, sem deadlock', async () => {
  const service = buildService()
  const deletions = buildDeletions()
  await seedConfig()
  const buyer = uid()
  const requester = uid()
  const admin = uid()
  await db.doc(`users/${buyer}`).set({ role: 'user' })
  await db.doc(`users/${requester}`).set({ role: 'superadmin' })
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  await db.doc('maintenance/adminV1').set({ interactionsVersion: 1 })

  // Compra criada ANTES do pedido de exclusão.
  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })

  const { id } = await deletions.queue('account', buyer, requester)
  const jobRef = db.doc(`deletionJobs/${id}`)
  await deletions.step(jobRef)
  assert.equal((await jobRef.get()).data().state, 'blocked_financial_review')

  // confirmCashPurchase NÃO deve ser rejeitado só porque deletionJobs/account_{uid}
  // existe -- isso criaria um deadlock (exclusão espera a compra resolver, compra
  // espera a exclusão não existir).
  await service.confirmCashPurchase(admin, purchaseId)
  assert.equal((await getPurchase(purchaseId)).status, 'credited')
})

test('admin cancela compra enquanto a exclusão está blocked_financial_review -- permitido, e a exclusão volta para pending', async () => {
  const service = buildService()
  const deletions = buildDeletions()
  await seedConfig()
  const buyer = uid()
  const requester = uid()
  const admin = uid()
  await db.doc(`users/${buyer}`).set({ role: 'user' })
  await db.doc(`users/${requester}`).set({ role: 'superadmin' })
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  await db.doc('maintenance/adminV1').set({ interactionsVersion: 1 })

  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })
  const { id } = await deletions.queue('account', buyer, requester)
  const jobRef = db.doc(`deletionJobs/${id}`)
  await deletions.step(jobRef)
  assert.equal((await jobRef.get()).data().state, 'blocked_financial_review')

  await service.cancelCashPurchase(admin, purchaseId, 'usuário confirmou que nunca pagou o PIX')

  // Resolução financeira -> a Function correspondente recoloca o job em pending sozinha.
  const job = await jobRef.get()
  assert.equal(job.data().state, 'pending', 'nenhum saldo restante e nenhuma compra pending -- pode prosseguir')
  assert.equal(job.data().blockReason, undefined)

  // A exclusão agora prossegue normalmente numa próxima chamada a step().
  await deletions.step(jobRef)
  const jobAfterResume = await jobRef.get()
  assert.ok(jobAfterResume.data().stage > 0, 'a exclusão voltou a avançar de verdade')
})

test('confirmar uma compra credita EvoCash -- o job de exclusão permanece blocked (agora por cashBalance > 0), não reativa sozinho', async () => {
  const service = buildService()
  const deletions = buildDeletions()
  await seedConfig()
  const buyer = uid()
  const requester = uid()
  const admin = uid()
  await db.doc(`users/${buyer}`).set({ role: 'user' })
  await db.doc(`users/${requester}`).set({ role: 'superadmin' })
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  await db.doc('maintenance/adminV1').set({ interactionsVersion: 1 })

  const { purchaseId } = await service.requestCashPurchase(buyer, {
    packageId: PACKAGE_ID,
    requestId: requestId(),
  })
  const { id } = await deletions.queue('account', buyer, requester)
  const jobRef = db.doc(`deletionJobs/${id}`)
  await deletions.step(jobRef)
  assert.equal((await jobRef.get()).data().blockReason, 'pending_cash_purchase')

  await service.confirmCashPurchase(admin, purchaseId)

  const job = await jobRef.get()
  assert.equal(
    job.data().state,
    'blocked_financial_review',
    'confirmar creditou EvoCash -- ainda bloqueado, agora por saldo positivo, não por bloqueador de release resolvido sozinho'
  )
  assert.equal(job.data().blockReason, 'positive_cash_balance')
})
