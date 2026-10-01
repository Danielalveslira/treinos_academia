import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Exercises.jsx puxa useExercises/useDashboard/useToast/useConfirmDelete (contexts/hooks
// reais, que por sua vez puxam Supabase/@primer's ConfirmationDialog) e ExerciseForm/
// ExerciseCatalog (fora de escopo neste teste, que é sobre a lista/busca/filtro/grupo
// redesenhados) -- todos trocados por fixtures em memória, mesmo padrão de stub via
// esbuild já usado no resto do projeto (ver workout.test.js, WorkoutExerciseGuide.test.js).
let directory
let render
let clickChip
let searchFor
let toggleGroup

const exercises = [
  {
    // equipment em formato cru de catálogo (snapshot direto de exercise_catalog.equipment,
    // hífen/sem acento) -- exerciseSubtitle deve formatar isso, não mostrar cru.
    id: 'a', name: 'Abraçar a Bola', muscleGroup: 'Costas', equipment: 'bola-de-exercicio',
    active: true, source: 'catalog', providerExerciseId: 'Hug_A_Ball',
  },
  {
    id: 'b', name: 'Agachamento Livre', muscleGroup: 'Pernas', equipment: 'barra',
    active: true, source: 'custom', providerExerciseId: null,
  },
  {
    id: 'c', name: 'Supino Reto', muscleGroup: 'Peito', equipment: null,
    active: true, source: 'custom', providerExerciseId: null,
  },
]

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'exercises-page-tests-'))
  const outfile = join(directory, 'page.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import Exercises from './Exercises.jsx'

        const tree = () => createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(MemoryRouter, null, createElement(Exercises))))

        export const render = () => renderToStaticMarkup(tree())

        // @primer/react's BaseStyles/ThemeProvider touch \`document\` in a mount effect
        // (color-mode attributes) -- irrelevant here (this test is about search/filter/
        // grupo, não tema), mas sem algum \`document\` global, TestRenderer + act (que,
        // ao contrário de renderToStaticMarkup, roda efeitos de verdade) derruba com
        // "document is not defined" num ambiente Node puro. Um proxy genérico (no-op em
        // qualquer propriedade/chamada) é suficiente sem precisar espelhar a API real.
        function noopProxy() {
          return new Proxy(() => noopProxy(), {
            get: (_target, prop) => {
              // Permite usar o proxy em contexto de string (ex.: window.navigator.platform
              // testado contra uma regex) sem "Cannot convert object to primitive value".
              if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf') {
                return () => ''
              }
              return noopProxy()
            },
            apply: () => noopProxy(),
          })
        }
        function makePage() {
          global.document = noopProxy()
          global.window = noopProxy()
          let component
          act(() => { component = TestRenderer.create(tree()) })
          return component
        }

        // .props.children de um componente-container (Box, o "row" inteiro) carrega a
        // árvore de elementos React ainda não renderizada (com refs de contexto/Provider)
        // -- JSON.stringify nisso é circular. Em vez disso, olha só os nós HOST cujo
        // children já é uma string de verdade (os nomes/subtítulos renderizados).
        function rowTexts(row) {
          return row
            .findAll((node) => typeof node.props?.children === 'string')
            .map((node) => node.props.children)
        }

        function visibleRowTexts(component) {
          return component.root
            .findAllByProps({ className: 'exercise-row-main' })
            .map((row) => rowTexts(row).join(' | '))
        }

        export const searchFor = (term) => {
          const component = makePage()
          act(() => {
            component.root.findByProps({ placeholder: 'Buscar na biblioteca...' }).props.onChange({ target: { value: term } })
          })
          const result = visibleRowTexts(component)
          act(() => component.unmount())
          return result
        }

        export const clickChip = (label) => {
          const component = makePage()
          act(() => {
            const chip = component.root
              .findAllByProps({ role: 'tab' })
              .find((el) => rowTexts(el).includes(label))
            chip.props.onClick()
          })
          const result = visibleRowTexts(component)
          act(() => component.unmount())
          return result
        }

        export const toggleGroup = (groupName) => {
          const component = makePage()
          const before = component.root.findAllByProps({ className: 'exercise-list' }).length
          act(() => {
            const heading = component.root
              .findAllByProps({ className: 'exercise-group-heading' })
              .find((el) => rowTexts(el).includes(groupName))
            heading.props.onClick()
          })
          const after = component.root.findAllByProps({ className: 'exercise-list' }).length
          act(() => component.unmount())
          return { before, after }
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
        name: 'exercises-page-fixtures',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/contexts\/ExercisesContext$/ }, (args) => ({
            path: args.path, namespace: 'fixture-exercises',
          }))
          pluginBuild.onResolve({ filter: /\/hooks\/useDashboard$/ }, (args) => ({
            path: args.path, namespace: 'fixture-dashboard',
          }))
          pluginBuild.onResolve({ filter: /\/hooks\/useToast$/ }, (args) => ({
            path: args.path, namespace: 'fixture-toast',
          }))
          pluginBuild.onResolve({ filter: /\/hooks\/useConfirmDelete$/ }, (args) => ({
            path: args.path, namespace: 'fixture-confirm',
          }))
          pluginBuild.onResolve({ filter: /\/components\/ExerciseForm$/ }, (args) => ({
            path: args.path, namespace: 'fixture-noop-component',
          }))
          pluginBuild.onResolve({ filter: /\/components\/ExerciseCatalog$/ }, (args) => ({
            path: args.path, namespace: 'fixture-noop-component',
          }))
          // RowActionsMenu usa @primer/react ActionMenu, que toca `document` de verdade
          // (portal/click-outside) num efeito -- fora de escopo aqui (o teste é sobre
          // busca/filtro/grupo, não o menu de ações), então vira um placeholder simples.
          pluginBuild.onResolve({ filter: /\/components\/RowActionsMenu$/ }, (args) => ({
            path: args.path, namespace: 'fixture-noop-component',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-exercises' }, () => ({
            contents: `
              const FIXTURE = ${JSON.stringify(exercises)}
              export function useExercises() {
                return {
                  exercises: FIXTURE, loading: false, error: null,
                  add: async () => {}, addFromCatalog: async () => ({ added: true }),
                  edit: async () => {}, remove: async () => {}, reorder: async () => {},
                  refresh: () => {},
                }
              }
            `,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-dashboard' }, () => ({
            contents: `export function useDashboard() { return { allWorkouts: [] } }`,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-toast' }, () => ({
            contents: `export function useToast() { return { toasts: [], showToast: () => {} } }`,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-confirm' }, () => ({
            contents: `export function useConfirmDelete() { return async () => true }`,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-noop-component' }, () => ({
            contents: `export const ExerciseForm = () => null; export const ExerciseCatalog = () => null; export const RowActionsMenu = () => null`,
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  ;({ render, clickChip, searchFor, toggleGroup } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('renderiza os 3 exercícios com nome acentuado, agrupados, com contador e chips reais', () => {
  const html = render()
  assert.match(html, /Abraçar a Bola/)
  assert.match(html, /3 exercícios/)
  assert.match(html, />Todos</)
  assert.match(html, />Costas</)
  assert.match(html, />Pernas</)
  assert.match(html, />Peito</)
})

test('linha mostra grupo · equipamento quando existe, e nunca um metadado ausente', () => {
  const html = render()
  assert.match(html, /Costas · Bola de Exercício/)
  assert.match(html, /Pernas · Barra/)
  // Supino Reto não tem equipment -- nunca "Peito · " nem "Peito · null/undefined".
  assert.match(html, />Peito<\/span>/)
  assert.doesNotMatch(html, /Peito · /)
})

test('busca local encontra nome acentuado digitando sem acento (case/accent-insensitive)', () => {
  const rows = searchFor('abracar')
  assert.equal(rows.length, 1)
  assert.match(rows[0], /Abraçar a Bola/)
})

test('busca sem resultado não quebra -- lista vazia', () => {
  const rows = searchFor('exercicio-que-nao-existe')
  assert.equal(rows.length, 0)
})

test('chip de grupo filtra pro grupo certo', () => {
  const rows = clickChip('Pernas')
  assert.equal(rows.length, 1)
  assert.match(rows[0], /Agachamento Livre/)
})

test('grupo é recolhível -- clicar no cabeçalho esconde a lista daquele grupo', () => {
  const { before, after: afterToggle } = toggleGroup('Costas')
  assert.equal(before, 3)
  assert.equal(afterToggle, 2)
})
