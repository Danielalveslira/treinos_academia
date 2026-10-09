import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advance, currentId, reconcile, shuffle, startCycle } from './spotlightCycle.js'

// gerador determinístico (LCG) para testes reproduzíveis
function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}
const ids = ['a', 'b', 'c', 'd']

test('shuffle é permutação e não altera o original', () => {
  const input = [...ids]
  const out = shuffle(input, seeded(1))
  assert.deepEqual([...out].sort(), ids)
  assert.deepEqual(input, ids)
})

test('ciclo completo mostra todos uma vez antes de repetir, e o recomeço nunca repete o último como primeiro', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const random = seeded(seed)
    let state = startCycle(ids, null, random)
    let previousLast = null
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const seen = [currentId(state)]
      for (let step = 1; step < ids.length; step += 1) {
        state = advance(state, ids, random)
        seen.push(currentId(state))
      }
      assert.deepEqual([...seen].sort(), ids, 'todos exatamente uma vez no ciclo')
      if (previousLast !== null)
        assert.notEqual(seen[0], previousLast, 'primeiro != último do ciclo anterior')
      previousLast = seen[seen.length - 1]
      state = advance(state, ids, random) // novo ciclo
    }
  }
})

test('com apenas um destaque o ciclo é fixo (e reinicia no mesmo, sem laço)', () => {
  let state = startCycle(['x'], null)
  assert.equal(currentId(state), 'x')
  state = advance(state, ['x'])
  assert.equal(currentId(state), 'x')
  assert.equal(currentId(startCycle([], null)), null)
})

test('destaque que vira inelegível sai na hora, sem pular nem repetir os demais', () => {
  const random = seeded(7)
  let state = startCycle(ids, null, random)
  const first = currentId(state)
  const rest = ids.filter((id) => id !== first)
  // sai o destaque ATUAL: passa direto ao seguinte do ciclo
  const afterRemove = reconcile(state, rest, random)
  assert.equal(currentId(afterRemove), state.order[1])
  assert.ok(!afterRemove.order.includes(first))
  // sai um que ainda não apareceu: o ciclo continua com os demais
  const dropped = state.order[3]
  const without = reconcile(
    state,
    ids.filter((id) => id !== dropped),
    random
  )
  assert.equal(currentId(without), first)
  assert.deepEqual(
    [...without.order].sort(),
    ids.filter((id) => id !== dropped)
  )
  // todos inelegíveis: nada para mostrar
  assert.equal(currentId(reconcile(state, [], random)), null)
})

test('destaque novo entra no que falta do ciclo atual; sem mudança devolve o mesmo estado', () => {
  const random = seeded(3)
  const state = startCycle(['a', 'b', 'c'], null, random)
  assert.equal(reconcile(state, ['a', 'b', 'c'], random), state)
  const grown = reconcile(state, ['a', 'b', 'c', 'n'], random)
  assert.ok(grown.order.includes('n'))
  assert.equal(
    grown.order.indexOf('n') >= grown.index,
    true,
    'novo entra à frente, não antes do atual'
  )
  assert.equal(currentId(grown), currentId(state), 'o atual não muda')
})

test('distribuição justa: cada destaque abre o ciclo aproximadamente na mesma proporção', () => {
  const random = seeded(42)
  const counts = { a: 0, b: 0, c: 0, d: 0 }
  for (let i = 0; i < 4000; i += 1) counts[currentId(startCycle(ids, null, random))] += 1
  for (const id of ids) assert.ok(counts[id] > 800 && counts[id] < 1200, `${id}: ${counts[id]}`)
})

test('equidade: em 200 ciclos cada destaque aparece exatamente 200 vezes, em qualquer posição do feed', () => {
  const random = seeded(11)
  const everyone = ['a', 'b', 'c', 'd', 'e']
  const counts = Object.fromEntries(everyone.map((id) => [id, 0]))
  const firstCounts = Object.fromEntries(everyone.map((id) => [id, 0]))
  let state = startCycle(everyone, null, random)
  for (let cycle = 0; cycle < 200; cycle += 1) {
    firstCounts[currentId(state)] += 1
    for (let step = 0; step < everyone.length; step += 1) {
      counts[currentId(state)] += 1
      state = advance(state, everyone, random)
    }
  }
  for (const id of everyone) {
    assert.equal(counts[id], 200, `${id} aparece uma vez por ciclo`)
    assert.ok(
      firstCounts[id] > 20 && firstCounts[id] < 60,
      `${id} abre ciclos de forma equilibrada: ${firstCounts[id]}`
    )
  }
})
