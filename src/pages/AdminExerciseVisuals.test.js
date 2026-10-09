import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Página /admin/exercicios-imagens com o hook e os componentes REAIS; só a camada de serviço (Supabase) e o
// status de conexão são stubs, controlados por globalThis.__svc / globalThis.__online.
let directory
let mount

const STUBS = {
  exerciseVisualsService: `
    export const PAGE_SIZE = 20
    export const describeVisualError = (e) => 'erro:' + (e && e.message)
    const call = (name, args, value) => { globalThis.__svc.calls.push([name, ...args]); return value() }
    export const listCatalogForVisuals = (...a) => call('listCatalogForVisuals', a, () => Promise.resolve(globalThis.__svc.catalog))
    export const getVisualCoverage = (...a) => call('getVisualCoverage', a, () => Promise.resolve(globalThis.__svc.coverage))
    export const getActiveStyleProfile = (...a) => call('getActiveStyleProfile', a, () => Promise.resolve(null))
    export const listVisualSets = (...a) => call('listVisualSets', a, () => Promise.resolve(globalThis.__svc.sets))
    export const uploadVisualSet = (...a) => call('uploadVisualSet', a, () => Promise.resolve({}))
    export const publishVisualSet = (...a) => call('publishVisualSet', a, () => globalThis.__svc.publish())
    export const rejectVisualSet = (...a) => call('rejectVisualSet', a, () => Promise.resolve({}))
    export const restoreVisualSet = (...a) => call('restoreVisualSet', a, () => Promise.resolve({}))
  `,
  useOnlineStatus: `export function useOnlineStatus() { return globalThis.__online }`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'admin-exercise-visuals-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import AdminExerciseVisuals from './AdminExerciseVisuals.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''))
        export function mountPage() {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(AdminExerciseVisuals))))
          })
          const root = renderer.root
          const buttons = (label) => root.findAll((n) => n.type === 'button' && textOf(n).trim() === label)
          return {
            text: () => textOf(renderer.toJSON()),
            button: (label) => buttons(label)[0],
            hasButton: (label) => buttons(label).length > 0,
            click: (node) => act(() => { node.props.onClick({ preventDefault() {} }) }),
            checkAll: () => root.findAll((n) => n.type === 'input' && n.props.type === 'checkbox' && n.props.onChange && n.props.checked === false && !n.props['aria-label'])
              .forEach((box) => act(() => box.props.onChange({ target: { checked: true } }))),
            pickFile: (id, name) => act(() => { root.findAll((n) => n.type === 'input' && n.props.id === id)[0].props.onChange({ target: { files: [{ name, type: 'image/png', size: 100 }] } }) }),
            setTool: (value) => act(() => { root.findAll((n) => n.type === 'input' && n.props.placeholder && n.props.placeholder.startsWith('Ex.:'))[0].props.onChange({ target: { value } }) }),
            submitUpload: () => act(() => { root.findByProps({ className: 'ev-upload' }).props.onSubmit({ preventDefault() {} }) }),
            rowButtons: () => root.findAll((n) => n.type === 'button' && String(n.props.className).includes('exercise-visuals-row')),
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
            b.onResolve({ filter: new RegExp(`(^|/)${name}(\\\\.jsx?)?$`) }, () => ({
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
const called = (name) => globalThis.__svc.calls.filter(([n]) => n === name)

const EXERCISE = {
  id: 'ex-1',
  name: 'Supino reto',
  primary_muscle: 'peito',
  muscles: ['peito', 'triceps'],
  equipment: 'barra',
  category: 'forca',
  difficulty: 'iniciante',
  force: 'push',
  mechanic: 'composto',
  instructions: ['Empurre a barra.'],
  published_media_refs: { images: [] },
}
const set = (id, version, status, extra = {}) => ({
  id,
  version,
  status,
  generation_source: 'gemini_manual',
  created_at: '2026-10-09T12:00:00Z',
  metadata: {},
  previewUrls: {
    start: `https://x/${id}/start.webp`,
    end: `https://x/${id}/end.webp`,
    thumbnail: `https://x/${id}/thumb.webp`,
  },
  ...extra,
})

beforeEach(() => {
  globalThis.__online = true
  globalThis.__svc = {
    calls: [],
    catalog: {
      data: [
        EXERCISE,
        { ...EXERCISE, id: 'ex-2', name: 'Agachamento', published_media_refs: { version: 3 } },
      ],
      total: 2,
    },
    coverage: { total: 868, published: 20, missing: 848, percent: (20 / 868) * 100 },
    sets: [],
    publish: () => Promise.resolve({}),
  }
})

test('lista o catálogo e mostra a cobertura (868 / 20 / 848 / 2,3%)', async () => {
  const page = mount()
  await tick()
  const text = page.text()
  assert.match(text, /Imagens dos exercícios/)
  assert.match(text, /868 exercícios · 20 publicados · 848 sem imagem · 2,3% de cobertura/)
  assert.doesNotMatch(text, /Gemini/, 'a interface não é atrelada a um provedor de IA')
  assert.match(text, /Gerencie, revise e publique as imagens oficiais do catálogo\./)
  assert.match(text, /Supino reto/)
  assert.match(text, /v3/)
  assert.equal(page.rowButtons().length, 2)
  assert.deepEqual(called('listCatalogForVisuals')[0][1], {
    q: '',
    onlyMissing: false,
    limit: 20,
    offset: 0,
  })
  page.unmount()
})

test('selecionar um exercício carrega os conjuntos e oferece o prompt + upload (sem publicar nada)', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.deepEqual(called('listVisualSets')[0], ['listVisualSets', 'ex-1'])
  const text = page.text()
  assert.match(text, /Criar com IA/)
  assert.match(text, /Copiar prompt/)
  assert.doesNotMatch(text, /Gemini/)
  assert.match(text, /Sem imagem/)
  assert.doesNotMatch(text, /Aguardando revisão/, 'sem nada em revisão a seção não ocupa espaço')
  assert.match(text, /Histórico \(0\)/)
  assert.match(text, /Nenhuma versão enviada ainda/)
  assert.equal(
    page.hasButton('Enviar para revisão'),
    false,
    'o formulário só abre em "Enviar imagens"'
  )
  page.click(page.button('Enviar imagens'))
  assert.equal(page.button('Enviar para revisão').props.disabled, true, 'sem arquivos não envia')
  page.click(page.button('Cancelar'))
  assert.equal(page.hasButton('Enviar para revisão'), false)
  assert.equal(called('publishVisualSet').length, 0)
  page.unmount()
})

test('"Aprovar e publicar" só habilita com o checklist inteiro marcado e então publica e recarrega', async () => {
  globalThis.__svc.sets = [
    set('s2', 2, 'review', { assets: [{ role: 'start' }, { role: 'end' }, { role: 'thumbnail' }] }),
  ]
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.match(page.text(), /Versão 2 em revisão/)
  assert.match(page.text(), /Em revisão/)
  assert.equal(page.button('Aprovar e publicar').props.disabled, true)
  page.checkAll()
  assert.equal(page.button('Aprovar e publicar').props.disabled, false)
  const listsBefore = called('listVisualSets').length
  page.click(page.button('Aprovar e publicar'))
  await tick()
  assert.deepEqual(called('publishVisualSet')[0], ['publishVisualSet', 's2'])
  assert.ok(
    called('listVisualSets').length > listsBefore,
    'recarrega os conjuntos depois de publicar'
  )
  assert.ok(called('getVisualCoverage').length >= 2, 'recarrega a cobertura')
  page.unmount()
})

test('falha ao publicar mostra o erro e não esconde nada', async () => {
  globalThis.__svc.sets = [
    set('s2', 2, 'review', { assets: [{ role: 'start' }, { role: 'end' }, { role: 'thumbnail' }] }),
  ]
  globalThis.__svc.publish = () => Promise.reject(new Error('COPY_FAILED'))
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  page.checkAll()
  page.click(page.button('Aprovar e publicar'))
  await tick()
  assert.match(page.text(), /erro:COPY_FAILED/)
  assert.match(page.text(), /Versão 2 em revisão/)
  page.unmount()
})

test('histórico: versão arquivada oferece rollback; publicada não', async () => {
  globalThis.__svc.sets = [
    set('s3', 3, 'published'),
    set('s2', 2, 'archived'),
    set('s1', 1, 'rejected', { metadata: { rejection: { reason: 'anatomia errada' } } }),
  ]
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  const text = page.text()
  assert.match(text, /Publicada · v3/)
  assert.match(text, /Arquivada/)
  assert.match(text, /Histórico \(3\)/)
  assert.match(text, /Motivo: anatomia errada/)
  assert.equal(page.hasButton('Restaurar esta versão (rollback)'), true)
  page.click(page.button('Restaurar esta versão (rollback)'))
  await tick()
  assert.deepEqual(called('restoreVisualSet')[0], ['restoreVisualSet', 's2'])
  page.unmount()
})

test('offline: avisa e trava as ações (aprovar/upload exigem servidor)', async () => {
  globalThis.__online = false
  globalThis.__svc.sets = [
    set('s2', 2, 'review', { assets: [{ role: 'start' }, { role: 'end' }, { role: 'thumbnail' }] }),
  ]
  const page = mount()
  await tick()
  assert.match(page.text(), /Sem conexão\. Enviar, aprovar e publicar imagens exige internet\./)
  page.click(page.rowButtons()[0])
  await tick()
  page.checkAll()
  assert.equal(page.button('Aprovar e publicar').props.disabled, true)
  assert.equal(page.button('Rejeitar').props.disabled, true)
  assert.equal(page.button('Enviar imagens').props.disabled, true)
  page.unmount()
})

test('conjunto em revisão sem miniatura avisa e continua aprovável (miniatura é opcional)', async () => {
  globalThis.__svc.sets = [set('s2', 2, 'review', { assets: [{ role: 'start' }, { role: 'end' }] })]
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.match(page.text(), /Sem miniatura: início e final podem ser publicados normalmente\./)
  page.checkAll()
  assert.equal(page.button('Aprovar e publicar').props.disabled, false)
  page.unmount()
})

test('o envio registra origem neutra (upload manual) e a ferramenta só como metadado opcional', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  page.click(page.button('Enviar imagens'))
  page.pickFile('visual-start', 's.png')
  page.pickFile('visual-end', 'e.png')
  page.setTool('  Minha IA  ')
  page.submitUpload()
  await tick()
  const [, args] = called('uploadVisualSet')[0]
  assert.equal(args.generationSource, 'manual_upload')
  assert.equal(args.metadata.tool, 'Minha IA')
  assert.equal(args.metadata.promptVersion, 'v1')
  assert.doesNotMatch(JSON.stringify(args), /gemini|google/i)
  page.unmount()
})
