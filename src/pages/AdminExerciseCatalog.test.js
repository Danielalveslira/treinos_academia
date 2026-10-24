import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Página /admin/exercicios com os hooks e componentes REAIS (useAdminExerciseCatalog +
// useAdminExerciseVisuals + ExerciseVisualDetail); só a camada de serviço (Supabase) e o status
// de conexão são stubs, controlados por globalThis.__catalogSvc / __visualsSvc / __online. Mesmo
// padrão de AdminExerciseVisuals.test.js.
let directory
let mount

const STUBS = {
  exerciseCatalogAdminService: `
    export const PAGE_SIZE = 20
    export const describeCatalogAdminError = (e) => 'erro:' + (e && e.message)
    const call = (name, args, value) => { globalThis.__catalogSvc.calls.push([name, ...args]); return value() }
    export const listCatalogExercises = (...a) => call('listCatalogExercises', a, () => Promise.resolve(globalThis.__catalogSvc.list))
    export const createCatalogDraft = (...a) => call('createCatalogDraft', a, () => globalThis.__catalogSvc.createDraft(a[0]))
    export const updateCatalogContent = (...a) => call('updateCatalogContent', a, () => globalThis.__catalogSvc.update(a[0], a[1]))
    export const submitCatalogForReview = (...a) => call('submitCatalogForReview', a, () => Promise.resolve({ ...globalThis.__catalogSvc.list.data[0], status: 'in_review' }))
    export const publishCatalogExercise = (...a) => call('publishCatalogExercise', a, () => Promise.resolve({ ...globalThis.__catalogSvc.list.data[0], status: 'published' }))
    export const withdrawCatalogExercise = (...a) => call('withdrawCatalogExercise', a, () => Promise.resolve({ ...globalThis.__catalogSvc.list.data[0], status: 'withdrawn' }))
    export const restoreCatalogExercise = (...a) => call('restoreCatalogExercise', a, () => Promise.resolve({ ...globalThis.__catalogSvc.list.data[0], status: 'in_review' }))
    export const listCatalogAuditLog = (...a) => call('listCatalogAuditLog', a, () => Promise.resolve([]))
  `,
  exerciseVisualsService: `
    export const PAGE_SIZE = 20
    export const describeVisualError = (e) => 'erro:' + (e && e.message)
    const call = (name, args, value) => { globalThis.__visualsSvc.calls.push([name, ...args]); return value() }
    export const listCatalogForVisuals = (...a) => call('listCatalogForVisuals', a, () => Promise.resolve({ data: [], total: 0 }))
    export const getVisualCoverage = (...a) => call('getVisualCoverage', a, () => Promise.resolve(globalThis.__visualsSvc.coverage))
    export const getActiveStyleProfile = (...a) => call('getActiveStyleProfile', a, () => Promise.resolve(null))
    export const listVisualSets = (...a) => call('listVisualSets', a, () => Promise.resolve([]))
    export const listVisualDeletions = (...a) => call('listVisualDeletions', a, () => Promise.resolve([]))
    export const deleteVisualSet = (...a) => call('deleteVisualSet', a, () => Promise.resolve({complete:true}))
    export const retryVisualDeletion = (...a) => call('retryVisualDeletion', a, () => Promise.resolve({complete:true}))
    export const uploadVisualSet = (...a) => call('uploadVisualSet', a, () => Promise.resolve({}))
    export const isDefinitiveUploadError = (e) => Boolean(e && e.definitive)
    export const newUploadRequestId = () => 'req-1'
    export const publishVisualSet = (...a) => call('publishVisualSet', a, () => Promise.resolve({}))
    export const rejectVisualSet = (...a) => call('rejectVisualSet', a, () => Promise.resolve({}))
    export const restoreVisualSet = (...a) => call('restoreVisualSet', a, () => Promise.resolve({}))
  `,
  useOnlineStatus: `export function useOnlineStatus() { return globalThis.__online }`,
  AdminNav: `export default function AdminNav() { return null }`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'admin-exercise-catalog-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import AdminExerciseCatalog from './AdminExerciseCatalog.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''))
        export function mountPage() {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          // Primer IconButton (usado no "remover" das listas dinâmicas) lê window.navigator.platform
          // para decidir o atalho de teclado a mostrar no tooltip (mesmo stub de AdminAccounts.test.js).
          global.window.navigator = global.window.navigator || { platform: 'Linux', userAgent: 'node' }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(AdminExerciseCatalog))))
          })
          const root = renderer.root
          const buttons = (label) => root.findAll((n) => n.type === 'button' && textOf(n).trim() === label)
          return {
            text: () => textOf(renderer.toJSON()),
            button: (label) => buttons(label)[0],
            click: (node) => act(() => { node.props.onClick({ preventDefault() {} }) }),
            rowButtons: () => root.findAll((n) => n.type === 'button' && String(n.props.className) === 'ev-row'),
            onlyMissingImagesCheckbox: () => root.findAll((n) => n.type === 'input' && n.props.type === 'checkbox')[0],
            toggle: (node) => act(() => { node.props.onChange({ target: { checked: !node.props.checked } }) }),
            hasImageIndicator: (id) => root.findAll((n) => n.props && n.props['data-testid'] === 'has-images-' + id).length > 0,
            nameInput: () => root.findAll((n) => n.type === 'input' && n.props['aria-label'] === undefined && n.props.value !== undefined && n.props.onChange)[0],
            setField: (ariaLabelOrFirst, value) => act(() => {
              const input = typeof ariaLabelOrFirst === 'string'
                ? root.findAll((n) => n.type === 'input' && n.props.onChange)[0]
                : ariaLabelOrFirst
              input.props.onChange({ target: { value } })
            }),
            unmount: () => act(() => renderer.unmount()),
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
    plugins: [
      {
        name: 'stubs',
        setup(b) {
          for (const name of Object.keys(STUBS)) {
            b.onResolve({ filter: new RegExp(`(^|/)${name}(\\.jsx?)?$`) }, () => ({
              path: name,
              namespace: 'stub',
            }))
          }
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents: STUBS[args.path],
            resolveDir: root,
            loader: 'jsx',
          }))
        },
      },
    ],
  })
  ;({ mountPage: mount } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 30))
const called = (bucket, name) => globalThis[bucket].calls.filter(([n]) => n === name)

const EXERCISE = {
  id: 'cat-1',
  name: 'Supino reto',
  status: 'published',
  revision: 3,
  primary_muscle: 'peito',
  muscles: ['peito', 'triceps'],
  equipment: 'barra',
  category: 'força',
  difficulty: 'iniciante',
  force: 'empurrar',
  mechanic: 'composto',
  instructions: ['Desça a barra.', 'Empurre.'],
  safety_notes: [],
  pending_content: null,
  published_media_refs: { version: 1, images: [] },
  total_count: 1,
}
const EXERCISE_NO_IMAGE = {
  ...EXERCISE,
  id: 'cat-2',
  name: 'Agachamento livre',
  published_media_refs: { images: [] },
}

beforeEach(() => {
  globalThis.__online = true
  globalThis.__catalogSvc = {
    calls: [],
    list: { data: [EXERCISE], total: 1 },
    createDraft: () => Promise.resolve({ ...EXERCISE, id: 'cat-new', status: 'draft' }),
    update: (id, fields) => Promise.resolve({ ...EXERCISE, ...fields, id }),
  }
  globalThis.__visualsSvc = {
    calls: [],
    coverage: { total: 868, published: 20, missing: 848, percent: (20 / 868) * 100 },
  }
})

test('mostra os indicadores de cobertura calculados no servidor (total/completas/pendentes/%)', async () => {
  const page = mount()
  await tick()
  const text = page.text()
  assert.match(text, /Exercícios cadastrados/)
  assert.match(text, /868/)
  assert.match(text, /Com imagens completas/)
  assert.match(text, /20/)
  assert.match(text, /Pendentes ou incompletas/)
  assert.match(text, /848/)
  assert.match(text, /Cobertura/)
  assert.match(text, /2,3%/)
  // getVisualCoverage já faz count('exact', head:true) contra a tabela inteira -- a página não
  // soma manualmente os itens da página carregada (que teria dado 1, não 868).
  assert.equal(called('__visualsSvc', 'getVisualCoverage').length, 1)
  page.unmount()
})

test('Salvar fica desabilitado sem alterações; habilita ao editar e desabilita de novo ao reverter', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()

  const saveButton = () => page.button('Salvar')
  assert.equal(saveButton().props.disabled, true, 'sem edição nenhuma, começa desabilitado')

  const nameInput = page.nameInput()
  page.setField(nameInput, 'Supino reto inclinado')
  await tick()
  assert.equal(saveButton().props.disabled, false, 'editar um campo habilita')

  page.setField(nameInput, 'Supino reto')
  await tick()
  assert.equal(saveButton().props.disabled, true, 'voltar ao valor original desabilita de novo')
  page.unmount()
})

test('salvar sem alteração nenhuma não chama o serviço; salvar com alteração chama uma vez e desabilita depois', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()

  page.click(page.button('Salvar'))
  await tick()
  assert.equal(called('__catalogSvc', 'updateCatalogContent').length, 0, 'sem isDirty, nenhuma requisição é feita')

  const nameInput = page.nameInput()
  page.setField(nameInput, 'Supino reto inclinado')
  await tick()
  page.click(page.button('Salvar'))
  await tick()
  assert.equal(called('__catalogSvc', 'updateCatalogContent').length, 1, 'edição real dispara exatamente uma chamada')
  assert.equal(page.button('Salvar').props.disabled, true, 'depois de salvar, volta a ficar desabilitado')
  page.unmount()
})

test('Criar rascunho começa desabilitado (sem seleção) e habilita ao digitar um nome', async () => {
  const page = mount()
  await tick()
  const createButton = () => page.button('Criar rascunho')
  assert.ok(createButton(), 'botão existe quando nada está selecionado')
  assert.equal(createButton().props.disabled, true)
  page.unmount()
})

test('indicador verde aparece só para exercícios com imagens START/END completas (published_media_refs.version)', async () => {
  globalThis.__catalogSvc.list = { data: [EXERCISE, EXERCISE_NO_IMAGE], total: 2 }
  const page = mount()
  await tick()
  assert.equal(page.hasImageIndicator('cat-1'), true, 'exercício com version publicada mostra o indicador')
  assert.equal(page.hasImageIndicator('cat-2'), false, 'exercício sem imagem não mostra o indicador')
  page.unmount()
})

test('filtro "Somente sem imagem" pede a página inteira filtrada no servidor, não a página carregada', async () => {
  const page = mount()
  await tick()
  assert.deepEqual(called('__catalogSvc', 'listCatalogExercises').at(-1)[1], {
    status: 'published',
    search: '',
    muscle: '',
    limit: 20,
    offset: 0,
    onlyMissingImages: false,
  })

  page.toggle(page.onlyMissingImagesCheckbox())
  await tick()
  assert.equal(called('__catalogSvc', 'listCatalogExercises').at(-1)[1].onlyMissingImages, true, 'liga o filtro')
  assert.equal(called('__catalogSvc', 'listCatalogExercises').at(-1)[1].offset, 0, 'volta pra primeira página ao ligar o filtro')

  page.toggle(page.onlyMissingImagesCheckbox())
  await tick()
  assert.equal(called('__catalogSvc', 'listCatalogExercises').at(-1)[1].onlyMissingImages, false, 'desliga o filtro')
  page.unmount()
})
