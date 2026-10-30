import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placementLabel, placementsSummary } from './placementLabels.js'

test('known placements translate to plain Portuguese, never the raw code', () => {
  assert.equal(placementLabel('home_banner'), 'Banner na página inicial')
  assert.equal(placementLabel('community_banner'), 'Banner da comunidade')
  assert.equal(placementLabel('community_feed'), 'Feed da comunidade')
})

test('an unknown code never leaks to the user as-is', () => {
  assert.equal(placementLabel('something_internal'), 'Posição não identificada')
})

test('a single real placement summarizes to its own label', () => {
  assert.equal(placementsSummary([{ code: 'home_banner', context: null }]), 'Banner na página inicial')
})

test('a network campaign expands to several real codes and summarizes generically, never as "network"', () => {
  const summary = placementsSummary([
    { code: 'home_banner', context: null },
    { code: 'community_banner', context: 'c1' },
  ])
  assert.equal(summary, 'Vários espaços do Evolutus')
})

test('no placements at all never throws', () => {
  assert.equal(placementsSummary(null), 'Posição não identificada')
  assert.equal(placementsSummary([]), 'Posição não identificada')
})
