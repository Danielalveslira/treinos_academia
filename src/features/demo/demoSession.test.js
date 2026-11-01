import test from 'node:test'
import assert from 'node:assert/strict'
import { demoReducer, demoTotals, initialDemoState } from './demoSession.js'

const change = (state, type, extra = {}) =>
  demoReducer(state, { type, id: state.exercises[0].id, ...extra })

test('demo inicia com sugestões fictícias pendentes e avança uma série por conclusão', () => {
  const initial = initialDemoState()
  assert.equal(initial.exercises[0].sets[0].source, 'history')
  assert.equal(demoTotals(initial).done, 0)
  const next = change(initial, 'conclude')
  assert.equal(demoTotals(next).done, 1)
  assert.equal(next.active[next.exercises[0].id], 1)
  assert.equal(next.exercises[0].sets[1].done, false)
  assert.equal(change(next, 'conclude', { id: 'missing' }), next)
})

test('edição aceita carga decimal e zero, mantém o registro confirmado até atualizar', () => {
  let state = change(initialDemoState(), 'conclude')
  state = change(state, 'select', { index: 0 })
  state = change(state, 'field', { field: 'weight', value: '62.5' })
  assert.equal(demoTotals(state).volume, 600)
  state = change(state, 'commit')
  assert.equal(demoTotals(state).volume, 625)
  assert.equal(demoTotals(state).comparisonPercent, 4)
  state = change(state, 'field', { field: 'weight', value: '0' })
  state = change(state, 'commit')
  assert.equal(demoTotals(state).volume, 0)
})

test('adicionar, remover, resumo parcial e reiniciar preservam números reais', () => {
  let state = initialDemoState()
  state = change(state, 'conclude')
  assert.deepEqual(
    [demoTotals(state).done, demoTotals(state).planned, demoTotals(state).completedExercises],
    [1, 12, 0]
  )
  state = change(state, 'add')
  assert.equal(demoTotals(state).planned, 13)
  assert.equal(demoTotals(state).comparisonPercent, 0)
  state = change(state, 'select', { index: 3 })
  state = change(state, 'remove')
  assert.equal(demoTotals(state).planned, 12)
  state = change(state, 'summary')
  assert.equal(state.summary, true)
  state = change(state, 'reset')
  assert.deepEqual([demoTotals(state).done, state.summary], [0, false])
})

test('série extra concluída elimina comparação sem histórico equivalente', () => {
  let state = initialDemoState()
  state = change(state, 'add')
  state = change(state, 'select', { index: 3 })
  state = change(state, 'conclude')
  assert.equal(demoTotals(state).done, 1)
  assert.equal(demoTotals(state).comparisonPercent, null)
})

test('comparação preserva a posição histórica após remover uma série anterior', () => {
  let state = initialDemoState()
  state = change(state, 'remove')
  state = change(state, 'conclude')
  assert.equal(state.exercises[0].sets[0].historyIndex, 1)
  assert.equal(demoTotals(state).volume, 540)
  assert.equal(demoTotals(state).comparisonPercent, 0)
})
