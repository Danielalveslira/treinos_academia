import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let renderGuide
let renderVisual
let openVisual

const exercise = {
  id: 'Row',
  name: 'Remada',
  imageRefs: ['Row/0.jpg', 'Row/1.jpg'],
  primaryMuscles: ['meio-das-costas'],
  equipment: 'barra',
  level: 'iniciante',
  instructions: ['Mantenha a coluna neutra.', 'Puxe a barra.'],
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'workout-guide-tests-'))
  const outfile = join(directory, 'guide.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import TestRenderer, { act } from 'react-test-renderer'
        import { WorkoutExerciseGuide, WorkoutExerciseVisual } from './WorkoutExerciseGuide.jsx'
        export const renderGuide = (exercise) => renderToStaticMarkup(createElement(
          WorkoutExerciseGuide,
          { exercise, onClose: () => {}, triggerRef: { current: null } }
        ))
        export const renderVisual = (exercise) => renderToStaticMarkup(createElement(
          WorkoutExerciseVisual,
          { exercise, group: 'Costas', displayName: exercise.name }
        ))
        export const openVisual = (exercise) => {
          global.document = {
            addEventListener: () => {},
            removeEventListener: () => {},
          }
          let component
          act(() => {
            component = TestRenderer.create(createElement(
              WorkoutExerciseVisual,
              { exercise, group: 'Costas', displayName: exercise.name }
            ))
          })
          act(() => {
            component.root.findByProps({ className: 'workout-guide-trigger' }).props.onClick()
          })
          const result = {
            dialogs: component.root.findAllByProps({ role: 'dialog' }).length,
            images: component.root.findAllByType('img').length,
          }
          act(() => component.unmount())
          return result
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: {
      'import.meta.env.VITE_EXERCISE_CATALOG_ASSET_BASE_URL':
        '"https://cdn.test/exercise-catalog/v1"',
      'import.meta.env.DEV': 'false',
    },
    logLevel: 'silent',
  })
  ;({ renderGuide, renderVisual, openVisual } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('workout header loads only the current thumbnail and exposes the execution button', () => {
  const html = renderVisual(exercise)
  assert.match(html, /workout-exercise-thumbnail/)
  assert.match(html, /thumb\.webp/)
  assert.match(html, /Ver execução/)
  assert.equal((html.match(/<img/g) || []).length, 1)
  assert.doesNotMatch(html, /0\.webp|1\.webp|role="dialog"/)
})

test('execution button opens the guide and only then mounts the two large images', () => {
  assert.deepEqual(openVisual(exercise), { dialogs: 1, images: 3 })
})

test('execution guide exposes two lazy images, metadata and numbered instructions', () => {
  const html = renderGuide(exercise)
  assert.match(html, /role="dialog"/)
  assert.match(html, /aria-modal="true"/)
  assert.match(html, /0\.webp/)
  assert.match(html, /1\.webp/)
  assert.equal((html.match(/loading="lazy"/g) || []).length, 2)
  assert.match(html, /Músculos/)
  assert.match(html, /Meio das costas/)
  assert.match(html, /<ol>/)
  assert.match(html, /Mantenha a coluna neutra\./)
  assert.match(html, /Puxe a barra\./)
})

test('execution guide omits an empty instructions section', () => {
  const html = renderGuide({ ...exercise, instructions: [] })
  assert.doesNotMatch(html, /workout-guide-instructions|Instruções/)
})
