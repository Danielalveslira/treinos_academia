import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let renderGuide
let renderVisual
let openVisual
let focusTrap
let focusTrapEdgeCases

// exercise agora é o exercício PESSOAL (snapshot mínimo: name/muscleGroup/equipment/
// providerExerciseId) -- o conteúdo rico (imagens/instruções/nível) vem de
// useExerciseCatalogDetail, mockado abaixo pra devolver um valor fixo e síncrono (o
// componente real busca isso em public.exercise_catalog via Supabase, que não faz
// sentido num teste de renderização puro).
const exercise = {
  id: 'personal-1',
  name: 'Remada',
  muscleGroup: 'Costas',
  equipment: 'barra',
  providerExerciseId: 'Row',
}
const detail = {
  id: 'Row',
  images: ['https://cdn.test/Row/0.jpg', 'https://cdn.test/Row/1.jpg'],
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
        // A11Y-1: Tab/Shift+Tab não pode escapar do modal para o conteúdo atrás do
        // backdrop. querySelectorAll é mockado devolvendo dois elementos focáveis fixos
        // (first/last); o teste simula Tab a partir do último (deve voltar ao primeiro,
        // com preventDefault) e Shift+Tab a partir do primeiro (deve ir ao último).
        export const focusTrap = (exercise) => {
          let activeElement = null
          const first = { focus: () => { activeElement = first } }
          const last = { focus: () => { activeElement = last } }
          let keydownHandler = null
          global.document = {
            addEventListener: (type, handler) => {
              if (type === 'keydown') keydownHandler = handler
            },
            removeEventListener: (type) => {
              if (type === 'keydown') keydownHandler = null
            },
            get activeElement() {
              return activeElement
            },
          }
          let component
          act(() => {
            component = TestRenderer.create(
              createElement(WorkoutExerciseVisual, {
                exercise,
                group: 'Costas',
                displayName: exercise.name,
              }),
              {
                createNodeMock: (element) => {
                  if (element.type === 'section') return { querySelectorAll: () => [first, last] }
                  if (element.type === 'button') return { focus: () => {} }
                  return null
                },
              }
            )
          })
          act(() => {
            component.root.findByProps({ className: 'workout-guide-trigger' }).props.onClick()
          })
          activeElement = last
          let forwardPrevented = false
          keydownHandler({
            key: 'Tab',
            shiftKey: false,
            preventDefault: () => {
              forwardPrevented = true
            },
          })
          const forwardWrapped = activeElement === first && forwardPrevented
          activeElement = first
          let backwardPrevented = false
          keydownHandler({
            key: 'Tab',
            shiftKey: true,
            preventDefault: () => {
              backwardPrevented = true
            },
          })
          const backwardWrapped = activeElement === last && backwardPrevented
          act(() => component.unmount())
          return { forwardWrapped, backwardWrapped }
        }
        // Casos de borda pedidos na revisão: 1 único elemento focável mantém o foco nele
        // mesmo (Tab e Shift+Tab), Escape continua fechando, e o foco volta ao trigger no
        // unmount -- direto no WorkoutExerciseGuide (sem passar pelo trigger real), com
        // onClose/triggerRef controlados pelo teste.
        export const focusTrapEdgeCases = (exercise) => {
          let activeElement = null
          const only = { focus: () => { activeElement = only } }
          let keydownHandler = null
          let triggerFocused = false
          let closeCalls = 0
          global.document = {
            addEventListener: (type, handler) => {
              if (type === 'keydown') keydownHandler = handler
            },
            removeEventListener: (type) => {
              if (type === 'keydown') keydownHandler = null
            },
            get activeElement() {
              return activeElement
            },
          }
          let component
          act(() => {
            component = TestRenderer.create(
              createElement(WorkoutExerciseGuide, {
                exercise,
                onClose: () => {
                  closeCalls += 1
                },
                triggerRef: {
                  current: {
                    focus: () => {
                      triggerFocused = true
                    },
                  },
                },
              }),
              {
                createNodeMock: (element) => {
                  if (element.type === 'section') return { querySelectorAll: () => [only] }
                  if (element.type === 'button') return { focus: () => {} }
                  return null
                },
              }
            )
          })
          activeElement = only
          let forwardPrevented = false
          keydownHandler({
            key: 'Tab',
            shiftKey: false,
            preventDefault: () => {
              forwardPrevented = true
            },
          })
          const staysForward = activeElement === only && forwardPrevented
          activeElement = only
          let backwardPrevented = false
          keydownHandler({
            key: 'Tab',
            shiftKey: true,
            preventDefault: () => {
              backwardPrevented = true
            },
          })
          const staysBackward = activeElement === only && backwardPrevented
          keydownHandler({ key: 'Escape', preventDefault: () => {} })
          const escapeClosed = closeCalls === 1
          act(() => component.unmount())
          return { staysForward, staysBackward, escapeClosed, focusReturnedToTrigger: triggerFocused }
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
    plugins: [
      {
        name: 'exercise-catalog-detail-stub',
        setup(context) {
          context.onResolve({ filter: /\/hooks\/useExerciseCatalogDetail\.js$/ }, () => ({
            path: 'detail-hook',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^detail-hook$/, namespace: 'stub' }, () => ({
            contents: `
              const DETAIL = ${JSON.stringify(detail)}
              export const useExerciseCatalogDetail = ({ catalogId, providerExerciseId } = {}) =>
                (catalogId || providerExerciseId)
                  ? { data: DETAIL, loading: false, unavailable: false }
                  : { data: null, loading: false, unavailable: true }
            `,
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  ;({ renderGuide, renderVisual, openVisual, focusTrap, focusTrapEdgeCases } = require(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('workout header loads only the current thumbnail and exposes the execution button', () => {
  const html = renderVisual(exercise)
  assert.match(html, /workout-exercise-thumbnail/)
  assert.match(html, /Row\/0\.jpg/)
  assert.match(html, /Ver execução/)
  assert.equal((html.match(/<img/g) || []).length, 1)
  assert.doesNotMatch(html, /Row\/1\.jpg|role="dialog"/)
})

test('execution button opens the guide and only then mounts the two large images', () => {
  assert.deepEqual(openVisual(exercise), { dialogs: 1, images: 3 })
})

test('execution guide exposes two lazy images, metadata and numbered instructions', () => {
  const html = renderGuide(exercise)
  assert.match(html, /role="dialog"/)
  assert.match(html, /aria-modal="true"/)
  assert.match(html, /Row\/0\.jpg/)
  assert.match(html, /Row\/1\.jpg/)
  assert.equal((html.match(/loading="lazy"/g) || []).length, 2)
  assert.match(html, /Músculos/)
  assert.match(html, /Meio das costas/)
  assert.match(html, /<ol>/)
  assert.match(html, /Mantenha a coluna neutra\./)
  assert.match(html, /Puxe a barra\./)
})

test('execution guide falls back to the personal snapshot when the catalog is unavailable', () => {
  const html = renderGuide({ ...exercise, providerExerciseId: null })
  assert.match(html, /Remada/)
  assert.match(html, /Costas/)
  assert.match(html, /Barra/)
  assert.match(html, /indisponível no momento/)
  assert.doesNotMatch(html, /Row\/0\.jpg/)
})

test('Tab from the last focusable element wraps to the first, and Shift+Tab from the first wraps to the last', () => {
  assert.deepEqual(focusTrap(exercise), { forwardWrapped: true, backwardWrapped: true })
})

test('with a single focusable element, Tab and Shift+Tab keep focus on it; Escape closes; focus returns to the trigger on unmount', () => {
  assert.deepEqual(focusTrapEdgeCases(exercise), {
    staysForward: true,
    staysBackward: true,
    escapeClosed: true,
    focusReturnedToTrigger: true,
  })
})
