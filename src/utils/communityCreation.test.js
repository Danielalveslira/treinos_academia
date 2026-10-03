import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attemptKeyOf,
  buildEligibilityChecklist,
  creationErrorMessage,
  describeEligibilityGap,
  paymentOptionsFor,
  productIsAvailable,
  shouldRenewRequestId,
} from './communityCreation.js'

const base = {
  eligible: false,
  accountDays: 24,
  requiredAccountDays: 30,
  qualifiedDays: 16,
  requiredQualifiedDays: 20,
  emailVerified: true,
  accountStanding: 'regular',
  activeOwnedCommunities: 1,
  communityLimit: 3,
  evoCoinsBalance: 420,
  evoCashBalance: 10,
}

test('checklist mostra o progresso exato (24/30 dias, 16/20 dias ativos, 1/3 comunidades)', () => {
  const byKey = Object.fromEntries(buildEligibilityChecklist(base).map((item) => [item.key, item]))
  assert.equal(byKey.accountAge.detail, '24 / 30 dias')
  assert.equal(byKey.accountAge.done, false)
  assert.equal(byKey.activeDays.detail, '16 / 20 dias ativos')
  assert.equal(byKey.activeDays.done, false)
  assert.equal(byKey.limit.detail, '1 / 3')
  assert.equal(byKey.limit.done, true)
  assert.equal(byKey.email.done, true)
  assert.equal(byKey.standing.done, true)
  assert.ok(Math.abs(byKey.accountAge.progress - 0.8) < 1e-9)
})

test('checklist nunca passa de 100% e limita o texto ao requisito', () => {
  const byKey = Object.fromEntries(
    buildEligibilityChecklist({ ...base, accountDays: 400, qualifiedDays: 30 }).map((item) => [
      item.key,
      item,
    ])
  )
  assert.equal(byKey.accountAge.detail, '30 / 30 dias')
  assert.equal(byKey.accountAge.progress, 1)
  assert.equal(byKey.activeDays.done, true)
})

test('mensagem lista exatamente o que falta, só requisitos públicos', () => {
  const gap = describeEligibilityGap(base)
  assert.equal(gap.eligible, false)
  assert.equal(gap.message, 'Faltam 6 dias de conta e 4 dias ativos para liberar a criação.')
})

test('singular, e-mail e três itens', () => {
  assert.equal(
    describeEligibilityGap({ ...base, accountDays: 29, qualifiedDays: 20 }).message,
    'Faltam 1 dia de conta para liberar a criação.'
  )
  assert.equal(
    describeEligibilityGap({ ...base, accountDays: 30, qualifiedDays: 20, emailVerified: false })
      .message,
    'Falta confirmar seu e-mail para liberar a criação.'
  )
  assert.equal(
    describeEligibilityGap({ ...base, emailVerified: false }).message,
    'Faltam confirmar seu e-mail, 6 dias de conta e 4 dias ativos para liberar a criação.'
  )
})

test('limite atingido explica o limite sem culpar dias', () => {
  const gap = describeEligibilityGap({
    ...base,
    accountDays: 30,
    qualifiedDays: 20,
    activeOwnedCommunities: 3,
  })
  assert.equal(gap.limitReached, true)
  assert.match(gap.message, /3 comunidades ativas/)
})

test('restrição/moderação vira mensagem genérica, sem detalhe sensível', () => {
  const gap = describeEligibilityGap({ ...base, accountStanding: 'unavailable' })
  assert.equal(gap.restricted, true)
  assert.equal(gap.message, 'Sua conta não está elegível para criar comunidades neste momento.')
  assert.deepEqual(gap.missing, [])
})

test('elegível: nenhuma pendência', () => {
  const gap = describeEligibilityGap({ ...base, eligible: true })
  assert.equal(gap.eligible, true)
  assert.equal(gap.message, '')
})

test('pagamento: só formas com preço válido; Arquivo sem EvoCoins; saldo insuficiente marcado', () => {
  const essential = { tier: 'essential', evoCoinsPrice: 300, evoCashPrice: null }
  const archive = { tier: 'archive', evoCoinsPrice: null, evoCashPrice: 500 }
  const none = { tier: 'archive', evoCoinsPrice: null, evoCashPrice: null }
  assert.deepEqual(
    paymentOptionsFor(essential, base).map((option) => [
      option.method,
      option.price,
      option.enough,
    ]),
    [['evocoins', 300, true]]
  )
  assert.deepEqual(
    paymentOptionsFor(archive, base).map((option) => [option.method, option.enough]),
    [['evocash', false]]
  )
  assert.equal(productIsAvailable(none), false)
  assert.equal(productIsAvailable(essential), true)
  assert.equal(paymentOptionsFor(null, base).length, 0)
})

test('erros do servidor viram mensagens amigáveis; restrição é genérica', () => {
  assert.equal(
    creationErrorMessage({ message: 'INSUFFICIENT_COINS' }),
    'Você não tem EvoCoins suficientes.'
  )
  assert.equal(
    creationErrorMessage({ message: 'ACCOUNT_NOT_ELIGIBLE' }),
    'Sua conta não está elegível para criar comunidades neste momento.'
  )
  assert.match(creationErrorMessage(new Error('boom')), /Não foi possível criar/)
})

test('idempotência: só conflito de chave renova; falha de rede mantém a chave', () => {
  assert.equal(shouldRenewRequestId({ message: 'REQUEST_ID_CONFLICT' }), true)
  assert.equal(shouldRenewRequestId({ message: 'Failed to fetch' }), false)
})

test('a chave da tentativa ignora espaços e muda com tier/pagamento', () => {
  const a = attemptKeyOf({
    name: ' X ',
    description: '',
    iconName: 'users',
    tier: 'essential',
    paymentMethod: 'evocoins',
  })
  const b = attemptKeyOf({
    name: 'X',
    description: ' ',
    iconName: 'users',
    tier: 'essential',
    paymentMethod: 'evocoins',
  })
  const c = attemptKeyOf({
    name: 'X',
    description: '',
    iconName: 'users',
    tier: 'plus',
    paymentMethod: 'evocoins',
  })
  assert.equal(a, b)
  assert.notEqual(a, c)
})
