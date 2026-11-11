import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Fase 4 (docs/prompts/PROMPT_EVOLUTUS_FASE_4_CATALOGO_V2.md): a vitrine/busca/filtros/cards
// redesenhados de ExerciseCatalog.jsx, isolados dos serviços reais (Supabase/IndexedDB, já
// testados a fundo em useExerciseCatalogSearch.test.js, exerciseCatalogService.test.js e
// CatalogOfflineStatus.test.js) -- aqui o hook de busca/taxonomia e a seção "Uso offline" são
// stubs controláveis via globalThis, e a folha modal (ModalSheet) também, porque ela depende de
// document.body/createPortal reais (sem jsdom neste projeto -- ver RowActionsMenu.test.js) e sua
// própria lógica (foco/Escape/viewport) já é testada em utils/modalSheet.test.js.
let directory
let api

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'exercise-catalog-tests-'))
  const outfile = join(directory, 'catalog.cjs')
  const componentsDir = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { ExerciseCatalog } from './ExerciseCatalog.jsx'

        export const mount = (props) => {
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({
            matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let tree
          act(() => {
            tree = TestRenderer.create(
              createElement(ThemeProvider, null, createElement(BaseStyles, null, createElement(ExerciseCatalog, props)))
            )
          })
          return tree
        }
        export function update(tree, props) {
          act(() => {
            tree.update(
              createElement(ThemeProvider, null, createElement(BaseStyles, null, createElement(ExerciseCatalog, props)))
            )
          })
        }
        export { act }
      `,
      resolveDir: componentsDir,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'catalog-component-stubs',
        setup(ctx) {
          ctx.onResolve({ filter: /\/hooks\/useExerciseCatalogSearch\.js$/ }, () => ({
            path: 'search-stub',
            namespace: 'stub',
          }))
          ctx.onResolve({ filter: /\/hooks\/useExerciseCatalogTaxonomy\.js$/ }, () => ({
            path: 'taxonomy-stub',
            namespace: 'stub',
          }))
          // ExerciseCatalog.jsx importa estes dois do MESMO diretório ('./CatalogOfflineStatus.jsx',
          // './ModalSheet.jsx') -- o filtro casa com o caminho RELATIVO como escrito (esbuild
          // resolve o onResolve sobre args.path antes de virar absoluto), nunca com "/components/".
          ctx.onResolve({ filter: /CatalogOfflineStatus\.jsx$/ }, () => ({
            path: 'offline-stub',
            namespace: 'stub',
          }))
          ctx.onResolve({ filter: /ModalSheet\.jsx$/ }, () => ({
            path: 'modal-stub',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^search-stub$/, namespace: 'stub' }, () => ({
            contents: `
              export function useExerciseCatalogSearch(args) {
                globalThis.__searchArgsCalls.push(args)
                return globalThis.__searchResult
              }
            `,
          }))
          ctx.onLoad({ filter: /^taxonomy-stub$/, namespace: 'stub' }, () => ({
            contents: `export function useExerciseCatalogTaxonomy() { return globalThis.__taxonomy }`,
          }))
          ctx.onLoad({ filter: /^offline-stub$/, namespace: 'stub' }, () => ({
            contents: `
              import { createElement } from 'react'
              export function CatalogOfflineStatus() {
                return createElement('div', { 'data-testid': 'offline-status' }, 'offline-status-stub')
              }
            `,
            resolveDir: componentsDir,
          }))
          // ModalSheet real usa createPortal(document.body) + efeitos de foco/viewport --
          // aqui, só uma casca em volta dos children, pra testar O QUE entra na ficha sem
          // depender de DOM real.
          ctx.onLoad({ filter: /^modal-stub$/, namespace: 'stub' }, () => ({
            contents: `
              import { createElement } from 'react'
              export function ModalSheet({ onClose, children }) {
                return createElement(
                  'div',
                  { 'data-testid': 'modal-sheet' },
                  createElement('button', { 'data-testid': 'modal-sheet-stub-close', onClick: onClose }, 'close-stub'),
                  children
                )
              }
              export function ModalSheetFrame({ title, footer, children }) {
                return createElement(
                  'div',
                  { 'data-testid': 'modal-sheet-frame' },
                  createElement('h2', null, title),
                  children,
                  footer
                )
              }
            `,
            resolveDir: componentsDir,
          }))
        },
      },
    ],
  })
  api = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

function textContent(node) {
  if (typeof node === 'string') return node
  if (!node?.children) return ''
  return node.children.map(textContent).join('')
}
const pageText = (tree) => textContent(tree.toJSON())

function allText(node) {
  try {
    return node.children.map((c) => (typeof c === 'string' ? c : allText(c))).join('')
  } catch {
    return ''
  }
}
// NUNCA act(async fn) com um setTimeout real (nunca libera o processo -- mesmo aviso de
// CatalogOfflineStatus.test.js); esperar fora do act e só então ler a árvore.
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

function buttonWithText(tree, pattern) {
  return tree.root.findAll(
    (node) => typeof node.props.onClick === 'function' && pattern.test(allText(node))
  )
}

function exercise(overrides) {
  return {
    id: overrides.id,
    providerExerciseId: overrides.providerExerciseId ?? overrides.id,
    provider: 'evolutus_dataset',
    name: overrides.name,
    primaryMuscles: overrides.primaryMuscles || ['peito'],
    secondaryMuscles: overrides.secondaryMuscles || [],
    equipment: overrides.equipment ?? 'barra',
    category: overrides.category ?? 'forca',
    level: overrides.level ?? 'iniciante',
    instructions: overrides.instructions || ['Faça isso.'],
    images: overrides.images || [],
    thumbnail: overrides.thumbnail ?? null,
  }
}

const BASE_RESULT = {
  total: null,
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMore: () => {},
  error: null,
  queryTooShort: false,
  noQueryIntent: true,
  fromCache: false,
  isPartialCache: false,
}

beforeEach(() => {
  globalThis.__searchArgsCalls = []
  globalThis.__taxonomy = {
    muscles: ['peito', 'dorsais', 'quadriceps'],
    equipment: ['barra'],
    categories: ['forca'],
    levels: ['iniciante'],
  }
  globalThis.__searchResult = { ...BASE_RESULT, items: [exercise({ id: 'c1', name: 'Supino Reto' })] }
})

function mount(props = {}) {
  return api.mount({ personalExercises: [], onAdd: async () => ({ added: true }), onClose: () => {}, ...props })
}

test('abre o catálogo já mostrando a vitrine inicial, sem pedir busca/filtro antes', () => {
  const view = mount()
  const text = pageText(view)
  assert.match(text, /Supino Reto/)
  assert.doesNotMatch(text, /Busque por nome ou escolha um filtro/)
  view.unmount()
})

test('atalhos de músculo só mostram valores reais da taxonomia (nunca um grupo inventado)', () => {
  const view = mount()
  const chips = view.root.findAll((node) => typeof node.props.className === 'string' && node.props.className.includes('chip'))
  const labels = chips.map((chip) => allText(chip))
  assert.ok(labels.some((label) => /Todos/.test(label)))
  assert.ok(labels.some((label) => /Peito/.test(label)))
  assert.ok(labels.some((label) => /Dorsais/.test(label)))
  assert.ok(labels.some((label) => /Quadríceps/.test(label)))
  // "Tríceps" não está na taxonomia do fixture -- nunca pode aparecer como atalho.
  assert.ok(!labels.some((label) => /Tríceps/.test(label)))
  view.unmount()
})

test('clicar num atalho de músculo usa o MESMO estado de consulta da busca (muscle no filtro)', () => {
  const view = mount()
  const peitoChip = view.root
    .findAll((node) => typeof node.props.className === 'string' && node.props.className.includes('chip'))
    .find((chip) => /Peito/.test(allText(chip)))
  api.act(() => peitoChip.props.onClick())
  const last = globalThis.__searchArgsCalls.at(-1)
  assert.equal(last.muscle, 'peito')
  view.unmount()
})

test('selecionar um filtro avançado (Equipamento, dentro de "Mais filtros") usa o mesmo estado', () => {
  const view = mount()
  const selects = view.root.findAll((node) => node.type === 'select')
  // 4 selects: Músculo, Equipamento, Categoria, Nível -- todos com opções reais no fixture.
  assert.equal(selects.length, 4)
  // A ordem no JSX é Músculo, Equipamento, Categoria, Nível.
  const equipmentSelect = selects[1]
  api.act(() => equipmentSelect.props.onChange({ target: { value: 'barra' } }))
  const last = globalThis.__searchArgsCalls.at(-1)
  assert.equal(last.equipment, 'barra')
  view.unmount()
})

test('filtro sem opções reais nunca é renderizado (ex.: Categoria vazia na taxonomia)', () => {
  globalThis.__taxonomy = { muscles: ['peito'], equipment: [], categories: [], levels: [] }
  const view = mount()
  const selects = view.root.findAll((node) => node.type === 'select')
  // Só "Músculo" tem opções -- Equipamento/Categoria/Nível somem (FilterSelect retorna null).
  assert.equal(selects.length, 1)
  view.unmount()
})

test('busca: botão de limpar só aparece com texto digitado e esvazia o campo ao clicar', () => {
  const view = mount()
  let input = view.root.findByProps({ placeholder: 'Buscar por nome do exercício' })
  assert.equal(view.root.findAllByProps({ 'aria-label': 'Limpar busca' }).length, 0)

  api.act(() => input.props.onChange({ target: { value: 'sup' } }))
  assert.equal(view.root.findAllByProps({ 'aria-label': 'Limpar busca' }).length, 1)

  api.act(() => view.root.findByProps({ 'aria-label': 'Limpar busca' }).props.onClick())
  input = view.root.findByProps({ placeholder: 'Buscar por nome do exercício' })
  assert.equal(input.props.value, '')
  assert.equal(view.root.findAllByProps({ 'aria-label': 'Limpar busca' }).length, 0)
  view.unmount()
})

test('card mostra "Com demonstração" só quando START e END estão publicados (nunca com só 1 imagem)', () => {
  globalThis.__searchResult = {
    ...BASE_RESULT,
    items: [
      exercise({ id: 'none', name: 'Sem Imagem', images: [] }),
      exercise({ id: 'one', name: 'Só Thumbnail', images: ['https://x/thumb.webp'] }),
      exercise({ id: 'two', name: 'Completo', images: ['https://x/start.webp', 'https://x/end.webp'] }),
    ],
  }
  const view = mount()
  const text = pageText(view)
  const demoCount = (text.match(/Com demonstração/g) || []).length
  assert.equal(demoCount, 1, 'só o exercício com as duas imagens mostra o selo')
  view.unmount()
})

// 5.1 (auditoria 2026-11-10): "na biblioteca" e "na ficha atual" são estados distintos -- o
// Catálogo não pode mais bloquear um exercício só porque ele já existe na biblioteca pessoal se
// ele ainda não está na ficha que o usuário está editando agora.
test('exercício já na ficha atual aparece como "Na ficha" e o botão fica desabilitado', () => {
  globalThis.__searchResult = {
    ...BASE_RESULT,
    items: [exercise({ id: 'c1', name: 'Supino Reto', providerExerciseId: 'Bench_Press' })],
  }
  const view = mount({
    personalExercises: [
      { id: 'lib-1', source: 'catalog', provider: 'evolutus_dataset', providerExerciseId: 'Bench_Press' },
    ],
    sheetExerciseIds: new Set(['lib-1']),
  })
  const addButton = buttonWithText(view, /Na ficha/)[0]
  assert.ok(addButton)
  assert.equal(addButton.props.disabled, true)
  view.unmount()
})

test('exercício já na biblioteca mas FORA da ficha atual aparece como "Adicionar à ficha", habilitado', () => {
  globalThis.__searchResult = {
    ...BASE_RESULT,
    items: [exercise({ id: 'c1', name: 'Supino Reto', providerExerciseId: 'Bench_Press' })],
  }
  let received
  const onAdd = async (item) => {
    received = item
    return { added: false }
  }
  const view = mount({
    personalExercises: [
      { id: 'lib-1', source: 'catalog', provider: 'evolutus_dataset', providerExerciseId: 'Bench_Press' },
    ],
    sheetExerciseIds: new Set(), // na biblioteca, mas ainda não nesta ficha
    onAdd,
  })
  const addButton = buttonWithText(view, /Adicionar à ficha/)[0]
  assert.ok(addButton)
  assert.equal(addButton.props.disabled, false)
  api.act(() => addButton.props.onClick())
  assert.equal(received.providerExerciseId, 'Bench_Press')
  view.unmount()
})

test('falha ao adicionar mostra mensagem curta e deixa o botão disponível para repetir (5.2)', async () => {
  globalThis.__searchResult = {
    ...BASE_RESULT,
    items: [exercise({ id: 'c1', name: 'Supino Reto', providerExerciseId: 'Bench_Press' })],
  }
  let reject
  const onAdd = () =>
    new Promise((_resolve, _reject) => {
      reject = _reject
    })
  const view = mount({ personalExercises: [], onAdd })
  const addButton = buttonWithText(view, /^Adicionar$/)[0]
  let completion
  api.act(() => {
    completion = addButton.props.onClick()
  })
  reject(new Error('boom'))
  await completion
  await settle()
  const text = pageText(view)
  assert.match(text, /Não foi possível adicionar\. Tente novamente\./)
  const retryButton = buttonWithText(view, /^Adicionar$/)[0]
  assert.equal(retryButton.props.disabled, false, 'botão continua clicável para repetir, nunca trava em "Adicionando..."')
  view.unmount()
})

test('clique duplicado em "Adicionar" nunca dispara uma segunda chamada concorrente', async () => {
  let calls = 0
  let resolveAdd
  const onAdd = () =>
    new Promise((resolve) => {
      calls += 1
      resolveAdd = resolve
    })
  globalThis.__searchResult = {
    ...BASE_RESULT,
    items: [exercise({ id: 'c1', name: 'Supino Reto', providerExerciseId: 'Bench_Press' })],
  }
  const view = mount({ personalExercises: [], onAdd })

  let completion
  const firstClick = buttonWithText(view, /^Adicionar$/)[0]
  api.act(() => {
    completion = firstClick.props.onClick()
  })
  assert.equal(calls, 1)

  // Depois do primeiro clique o botão já está "Adicionando..." -- clicar de novo (ex.: tecla
  // repetida antes do disabled surtir efeito) tem que ser ignorado pela trava de addingId,
  // nunca abrir uma segunda chamada concorrente.
  const secondClick = buttonWithText(view, /Adicionando/)[0]
  assert.ok(secondClick, 'botão precisa refletir o estado "adicionando"')
  api.act(() => {
    secondClick.props.onClick()
  })
  assert.equal(calls, 1, 'nenhuma segunda chamada concorrente')

  // Nunca act(async fn) com um setTimeout/promise real -- resolve fora do act (mesmo padrão de
  // CatalogOfflineStatus.test.js), senão o test runner nunca libera o processo.
  resolveAdd({ added: true })
  await completion
  await settle()
  // "Na ficha" é responsabilidade exclusiva de sheetExerciseIds (prop) -- sem cache local que
  // marque sozinho (continuação da auditoria, seção 4), o botão volta a "Adicionar" disponível
  // até o pai confirmar via prop, nunca fica travado em "Adicionando...".
  assert.ok(buttonWithText(view, /^Adicionar$/)[0], 'volta a clicável, nunca travado em "Adicionando..."')
  view.unmount()
})

// Continuação da auditoria (2026-11-10, seção 4): "na ficha" não pode ser um estado local que só
// cresce -- precisa refletir a remoção também, não só a adição.
test('fonte única de verdade: "Na ficha" segue sheetExerciseIds (prop), inclusive após remoção', () => {
  globalThis.__searchResult = {
    ...BASE_RESULT,
    items: [exercise({ id: 'c1', name: 'Supino Reto', providerExerciseId: 'Bench_Press' })],
  }
  const personalExercises = [
    { id: 'lib-1', source: 'catalog', provider: 'evolutus_dataset', providerExerciseId: 'Bench_Press' },
  ]
  const props = { personalExercises, sheetExerciseIds: new Set(['lib-1']), onAdd: async () => ({ added: false }) }
  const view = api.mount(props)
  assert.ok(buttonWithText(view, /Na ficha/)[0], 'presente na ficha atual')

  // O editor removeu o exercício: sheetExerciseIds não tem mais 'lib-1'. O Catálogo precisa
  // refletir isso IMEDIATAMENTE -- nunca ficar preso em "Na ficha" por causa de um estado local.
  api.update(view, { ...props, sheetExerciseIds: new Set() })
  const afterRemoval = buttonWithText(view, /Adicionar à ficha/)[0]
  assert.ok(afterRemoval, 'removido da ficha volta a "Adicionar à ficha" (continua na biblioteca)')
  assert.equal(afterRemoval.props.disabled, false)
  view.unmount()
})

test('abrir a ficha de um exercício preserva a listagem por baixo; fechar não reseta nada', () => {
  globalThis.__searchResult = {
    ...BASE_RESULT,
    items: [exercise({ id: 'c1', name: 'Supino Reto', instructions: ['Abaixe a barra.', 'Empurre para cima.'] })],
  }
  const view = mount()
  const openDetail = view.root.findByProps({ className: 'catalog-card-details' })
  api.act(() => openDetail.props.onClick())

  assert.ok(view.root.findByProps({ 'data-testid': 'modal-sheet' }))
  const detailText = pageText(view)
  assert.match(detailText, /Abaixe a barra\./)
  // A listagem continua montada por baixo da ficha -- nunca some ao abrir o detalhe.
  assert.match(detailText, /Supino Reto/)

  api.act(() => view.root.findByProps({ 'data-testid': 'modal-sheet-stub-close' }).props.onClick())
  assert.equal(view.root.findAllByProps({ 'data-testid': 'modal-sheet' }).length, 0)
  assert.match(pageText(view), /Supino Reto/)
  view.unmount()
})

test('resultado vindo de cache offline avisa que pode ser parcial, nunca finge catálogo completo', () => {
  globalThis.__searchResult = { ...BASE_RESULT, items: [exercise({ id: 'c1', name: 'Supino' })], fromCache: true, isPartialCache: true }
  const partial = mount()
  assert.match(pageText(partial), /pode(m)? ser só parte do catálogo/)
  partial.unmount()

  globalThis.__searchResult = { ...BASE_RESULT, items: [exercise({ id: 'c1', name: 'Supino' })], fromCache: true, isPartialCache: false }
  const complete = mount()
  assert.doesNotMatch(pageText(complete), /pode(m)? ser só parte do catálogo/)
  assert.match(pageText(complete), /salvo neste aparelho/)
  complete.unmount()
})

test('estados de carregando, erro e nenhum resultado são distintos e exclusivos', () => {
  globalThis.__searchResult = { ...BASE_RESULT, items: [], loading: true }
  const loading = mount()
  assert.match(pageText(loading), /Carregando catálogo/)
  loading.unmount()

  globalThis.__searchResult = { ...BASE_RESULT, items: [], loading: false, error: 'Não foi possível carregar o catálogo. Tente novamente.' }
  const errored = mount()
  assert.match(pageText(errored), /Não foi possível carregar/)
  errored.unmount()

  globalThis.__searchResult = { ...BASE_RESULT, items: [], loading: false, error: null }
  const empty = mount()
  assert.match(pageText(empty), /Nenhum resultado/)
  empty.unmount()
})

test('"Uso offline" fica compacto e fechado por padrão, mas logo no topo (antes da busca) -- nunca parece que sumiu', () => {
  const view = mount()
  const details = view.root.findAll((node) => node.props.className === 'catalog-offline-toggle')
  assert.equal(details.length, 1)
  assert.equal(details[0].props.open, undefined, 'fechado por padrão')
  assert.ok(view.root.findByProps({ 'data-testid': 'offline-status' }))

  function classNamesInOrder(node, out = []) {
    if (typeof node.props?.className === 'string') out.push(node.props.className)
    for (const child of node.children || []) {
      if (child && typeof child === 'object') classNamesInOrder(child, out)
    }
    return out
  }
  const order = classNamesInOrder(view.toJSON())
  const offlineIndex = order.indexOf('catalog-offline-toggle')
  const searchIndex = order.findIndex((name) => name.includes('catalog-search'))
  assert.ok(offlineIndex >= 0 && searchIndex >= 0)
  assert.ok(offlineIndex < searchIndex, 'aparece antes da busca, perto do topo')
  view.unmount()
})
