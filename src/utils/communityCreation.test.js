import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attemptKeyOf,
  buildEligibilityChecklist,
  creationErrorMessage,
  describeEligibilityGap,
  eligibilityPanelCoversError,
  paymentOptionsFor,
  productIsAvailable,
  shouldRenewRequestId,
} from './communityCreation.js'

// Dias de conta/dias ativos não são mais requisito (eligibility_simplify) -- base já reflete
// isso: eligible=true mesmo com accountDays/qualifiedDays abaixo dos antigos mínimos.
const base = {
  eligible: true,
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
  freeCommunityAvailable: true,
}

test('checklist mostra só e-mail, situação da conta e limite (sem dias)', () => {
  const byKey = Object.fromEntries(buildEligibilityChecklist(base).map((item) => [item.key, item]))
  assert.deepEqual(Object.keys(byKey).sort(), ['email', 'limit', 'standing'])
  assert.equal(byKey.limit.detail, '1 / 3')
  assert.equal(byKey.limit.done, true)
  assert.equal(byKey.email.done, true)
  assert.equal(byKey.standing.done, true)
})

test('mensagem: elegível não tem pendência mesmo com poucos dias de conta/atividade', () => {
  const gap = describeEligibilityGap(base)
  assert.equal(gap.eligible, true)
  assert.equal(gap.message, '')
  assert.deepEqual(gap.missing, [])
})

test('e-mail não confirmado é a única pendência possível hoje', () => {
  assert.equal(
    describeEligibilityGap({ ...base, eligible: false, emailVerified: false }).message,
    'Falta confirmar seu e-mail para liberar a criação.'
  )
})

test('limite atingido explica o limite', () => {
  const gap = describeEligibilityGap({
    ...base,
    eligible: false,
    activeOwnedCommunities: 3,
  })
  assert.equal(gap.limitReached, true)
  assert.match(gap.message, /3 comunidades ativas/)
})

test('restrição/moderação vira mensagem genérica, sem detalhe sensível', () => {
  const gap = describeEligibilityGap({ ...base, eligible: false, accountStanding: 'unavailable' })
  assert.equal(gap.restricted, true)
  assert.equal(gap.message, 'Sua conta não está elegível para criar comunidades neste momento.')
  assert.deepEqual(gap.missing, [])
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

test('grátis é um sinal explícito (product.free), nunca inferido por preço nulo', () => {
  const starter = { tier: 'starter', free: true, evoCoinsPrice: null, evoCashPrice: null }
  assert.equal(productIsAvailable(starter), true)
  assert.deepEqual(paymentOptionsFor(starter, base), [])
  // Um produto PAGO sem nenhum preço configurado continua indisponível -- "free" nunca é
  // inferido, só o campo explícito decide.
  const essentialSemPreco = { tier: 'essential', free: false, evoCoinsPrice: null, evoCashPrice: null }
  assert.equal(productIsAvailable(essentialSemPreco), false)
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
  assert.equal(
    creationErrorMessage({ message: 'FREE_BENEFIT_ALREADY_USED' }),
    'Você já usou sua comunidade gratuita.'
  )
  assert.equal(
    creationErrorMessage({ message: 'PRICE_CHANGED' }),
    'O preço mudou desde a última cotação. Confira o novo valor e confirme de novo.'
  )
  assert.match(creationErrorMessage(new Error('boom')), /Não foi possível criar/)
})

test('idempotência: só conflito de chave renova; falha de rede mantém a chave', () => {
  assert.equal(shouldRenewRequestId({ message: 'REQUEST_ID_CONFLICT' }), true)
  assert.equal(shouldRenewRequestId({ message: 'Failed to fetch' }), false)
})

test('a chave da tentativa ignora espaços e muda com tier/pagamento/post_access', () => {
  const a = attemptKeyOf({
    name: ' X ',
    description: '',
    iconName: 'users',
    tier: 'essential',
    paymentMethod: 'evocoins',
    postAccess: 'everyone',
  })
  const b = attemptKeyOf({
    name: 'X',
    description: ' ',
    iconName: 'users',
    tier: 'essential',
    paymentMethod: 'evocoins',
    postAccess: 'everyone',
  })
  const c = attemptKeyOf({
    name: 'X',
    description: '',
    iconName: 'users',
    tier: 'plus',
    paymentMethod: 'evocoins',
    postAccess: 'everyone',
  })
  const d = attemptKeyOf({
    name: 'X',
    description: '',
    iconName: 'users',
    tier: 'essential',
    paymentMethod: 'evocoins',
    postAccess: 'admins',
  })
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.notEqual(a, d)
})

test('a chave da tentativa para o caminho grátis não depende de paymentMethod', () => {
  const a = attemptKeyOf({ name: 'X', description: '', iconName: 'users', tier: 'starter', paymentMethod: null, postAccess: 'everyone' })
  const b = attemptKeyOf({ name: 'X', description: '', iconName: 'users', tier: 'starter', postAccess: 'everyone' })
  assert.equal(a, b)
})

// Regressão: CreateCommunity.jsx mostrava o Flash genérico de erro JUNTO com a mensagem
// própria de EligibilityPanel na etapa "info", duplicando a mesma informação na tela para
// ACCOUNT_NOT_ELIGIBLE/EMAIL_NOT_VERIFIED/COMMUNITY_LIMIT_REACHED. FREE_BENEFIT_ALREADY_USED
// (e qualquer outro código) não tem equivalente em EligibilityPanel -- precisa continuar
// aparecendo no Flash, senão o usuário não vê nada.
test('eligibilityPanelCoversError identifica exatamente os 3 códigos já mostrados por EligibilityPanel', () => {
  assert.equal(eligibilityPanelCoversError('ACCOUNT_NOT_ELIGIBLE'), true)
  assert.equal(eligibilityPanelCoversError('EMAIL_NOT_VERIFIED'), true)
  assert.equal(eligibilityPanelCoversError('COMMUNITY_LIMIT_REACHED'), true)
  assert.equal(eligibilityPanelCoversError('FREE_BENEFIT_ALREADY_USED'), false)
  assert.equal(eligibilityPanelCoversError('INSUFFICIENT_COINS'), false)
  assert.equal(eligibilityPanelCoversError(undefined), false)
})
