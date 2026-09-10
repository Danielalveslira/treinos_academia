import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let render
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'workout-form-tests-'))
  const outfile = join(directory, 'form.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { WorkoutForm } from './WorkoutForm.jsx'
        export const render = (props) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(WorkoutForm, props))))
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  })
  ;({ render } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const props = {
  exercises: [{ id: 'squat', name: 'Agachamento', active: true }],
  defaultExerciseId: 'squat',
}

test('new form creates one labelled set with numeric constraints and accessible actions', () => {
  const html = render(props)
  assert.equal((html.match(/type="number"/g) || []).length, 2)
  assert.match(html, /aria-label="Peso \(kg\), série 1"/)
  assert.match(html, /aria-label="Repetições, série 1"/)
  assert.match(html, /step="any"/)
  assert.match(html, /min="0"/)
  assert.match(html, /min="1"/)
  assert.match(html, /aria-label="Remover série 1"[^>]*disabled=""/)
  assert.match(html, /Repetir série/)
  assert.match(html, /Adicionar série/)
})

test('editing legacy and individual sets preserves values and inactive exercise selection', () => {
  for (const initialValue of [
    { exerciseId: 'squat', weight: 30, sets: 2, reps: 12, date: '2025-01-01', note: '' },
    {
      exerciseId: 'squat',
      setDetails: [
        { weight: 30, reps: 12 },
        { weight: 40, reps: 8 },
      ],
      date: '2025-01-01',
      note: '',
    },
  ]) {
    const html = render({
      ...props,
      exercises: [{ ...props.exercises[0], active: false }],
      initialValue,
    })
    assert.equal((html.match(/type="number"/g) || []).length, 4)
    // Um exercício inativo só continua selecionável quando é o próprio initialValue
    // (edição de um registro existente) — o passo de registro abre direto nele, sem
    // passar pelos passos de grupo/exercício, mostrando o nome no cabeçalho da etapa.
    assert.match(html, /<strong>Agachamento<\/strong>/)
    assert.match(html, /aria-label="Peso \(kg\), série 2"/)
    assert.match(html, /value="30"/)
  }
})

test('with no exercise pre-selected, the form opens on the muscle group step, not the set fields', () => {
  const html = render({
    exercises: [
      { id: 'squat', name: 'Agachamento', muscleGroup: 'Pernas', active: true },
      { id: 'bench', name: 'Supino', muscleGroup: 'Peito', active: true },
    ],
  })
  assert.match(html, /Qual grupo você vai treinar\?/)
  assert.match(html, /Pernas/)
  assert.match(html, /Peito/)
  assert.equal((html.match(/type="number"/g) || []).length, 0)
  assert.doesNotMatch(html, /Adicionar série/)
})
