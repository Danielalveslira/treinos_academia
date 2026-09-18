import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canModerateCommunity, evaluateCommunityCreationRequirements } from './communityOwnership.js'

test('canModerateCommunity: the owner of that exact community can moderate it', () => {
  assert.equal(
    canModerateCommunity({ isSuperAdmin: false, communityOwnerId: 'alice', uid: 'alice' }),
    true
  )
})

test('canModerateCommunity: the owner of a DIFFERENT community cannot moderate this one', () => {
  assert.equal(
    canModerateCommunity({ isSuperAdmin: false, communityOwnerId: 'bob', uid: 'alice' }),
    false
  )
})

test('canModerateCommunity: superadmin can moderate any community, even one they do not own', () => {
  assert.equal(
    canModerateCommunity({ isSuperAdmin: true, communityOwnerId: 'bob', uid: 'alice' }),
    true
  )
})

test('canModerateCommunity: a regular user with no relation to the community cannot moderate it', () => {
  assert.equal(
    canModerateCommunity({ isSuperAdmin: false, communityOwnerId: null, uid: 'alice' }),
    false
  )
  assert.equal(
    canModerateCommunity({ isSuperAdmin: false, communityOwnerId: undefined, uid: 'alice' }),
    false
  )
})

const PRIVILEGE = {
  minimumAccountAgeDays: 7,
  requireEmailVerified: true,
  minimumLifetimeCoins: 200,
  cashCost: 50,
}

function eligibleInput(overrides = {}) {
  return {
    privilege: PRIVILEGE,
    accountAgeDays: 30,
    emailVerified: true,
    lifetimeCoinsEarned: 500,
    cashBalance: 100,
    ...overrides,
  }
}

test('evaluateCommunityCreationRequirements: allMet is true when every requirement passes', () => {
  const { allMet, requirements } = evaluateCommunityCreationRequirements(eligibleInput())
  assert.equal(allMet, true)
  assert.equal(requirements.length, 4)
  assert.ok(requirements.every((requirement) => requirement.met))
})

test('evaluateCommunityCreationRequirements: the checklist reflects each requirement independently (controls the UX)', () => {
  const { allMet, requirements } = evaluateCommunityCreationRequirements(
    eligibleInput({ cashBalance: 10 })
  )
  assert.equal(allMet, false, 'um requisito falhando bloqueia o allMet geral')
  const cashRequirement = requirements.find((requirement) => requirement.key === 'cashBalance')
  assert.equal(cashRequirement.met, false)
  // os outros continuam corretamente "atendidos" -- a checklist não falha tudo junto.
  assert.equal(requirements.find((requirement) => requirement.key === 'accountAge').met, true)
  assert.equal(requirements.find((requirement) => requirement.key === 'lifetimeCoins').met, true)
})

test('evaluateCommunityCreationRequirements: e-mail não verificado só bloqueia quando a config exige', () => {
  const blocked = evaluateCommunityCreationRequirements(eligibleInput({ emailVerified: false }))
  assert.equal(blocked.allMet, false)

  const notRequired = evaluateCommunityCreationRequirements(
    eligibleInput({ emailVerified: false, privilege: { ...PRIVILEGE, requireEmailVerified: false } })
  )
  assert.equal(notRequired.allMet, true)
})

test('evaluateCommunityCreationRequirements: sem config carregada ainda, não afirma elegibilidade nenhuma', () => {
  const { requirements, allMet } = evaluateCommunityCreationRequirements({ privilege: null })
  assert.deepEqual(requirements, [])
  assert.equal(allMet, false)
})
