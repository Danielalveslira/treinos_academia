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
    export const getActiveStyleProfile = (...a) => call('getActiveStyleProfile', a, () => globalThis.__svc.profile())
    export const listVisualSets = (...a) => call('listVisualSets', a, () => Promise.resolve(globalThis.__svc.sets.filter(s => a[1]?.history || ['published','review'].includes(s.status))))
    export const listVisualDeletions = (...a) => call('listVisualDeletions', a, () => Promise.resolve(globalThis.__svc.deletions || []))
    export const deleteVisualSet = (...a) => call('deleteVisualSet', a, () => globalThis.__svc.discard())
    export const retryVisualDeletion = (...a) => call('retryVisualDeletion', a, () => Promise.resolve({complete:true}))
    export const uploadVisualSet = (...a) => call('uploadVisualSet', a, () => globalThis.__svc.upload())
    export const isDefinitiveUploadError = (e) => Boolean(e && e.definitive)
    export const newUploadRequestId = () => 'req-' + (globalThis.__svc.keys = (globalThis.__svc.keys || 0) + 1)
    export const publishVisualSet = (...a) => call('publishVisualSet', a, () => globalThis.__svc.publish())
    export const rejectVisualSet = (...a) => call('rejectVisualSet', a, () => {globalThis.__svc.sets=globalThis.__svc.sets.map(s=>s.id===a[0]?{...s,status:'rejected',metadata:{rejection:{reason:a[1]}}}:s);return Promise.resolve({})})
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
            openHistory: () => act(() => root.findByProps({ className:'ev-history' }).props.onToggle({currentTarget:{open:true}})),
            reviewChecks: () => root.findAll(n => n.type === 'div' && n.props.className === 'ev-review-card').flatMap(card => card.findAll(n => n.type === 'input' && n.props.type === 'checkbox')),
            imageError: () => act(() => root.findAll(n => n.type === 'img' && n.props.alt.startsWith('Final'))[0].props.onError()),
            rejectReason: (value) => act(() => root.findAll(n => n.type === 'select' && n.props['aria-label'] === 'Motivo da rejeição')[0].props.onChange({target:{value}})),
            loadImages: () => root.findAll(n => n.type === 'img' && n.props.onLoad).forEach(n => act(() => n.props.onLoad({currentTarget:{naturalWidth:n.props.alt.startsWith('Miniatura') ? 320 : 1024,naturalHeight:n.props.alt.startsWith('Miniatura') ? 320 : 1024}}))),
            checkAll: () => root.findAll((n) => n.type === 'div' && n.props.className === 'ev-review-card').flatMap(card => card.findAll((n) => n.type === 'input' && n.props.type === 'checkbox' && n.props.onChange && n.props.checked === false && !n.props['aria-label']))
              .forEach((box) => act(() => box.props.onChange({ target: { checked: true } }))),
            pickFile: (id, name) => act(() => { root.findAll((n) => n.type === 'input' && n.props.id === id)[0].props.onChange({ target: { files: [{ name, type: 'image/png', size: 100 }] } }) }),
            select: () => root.findAll((n) => n.type === 'select')[0],
            setProvider: (value) => act(() => { root.findAll((n) => n.type === 'select')[0].props.onChange({ target: { value } }) }),
            submitUploadTwice: () => act(() => { const form = root.findByProps({ className: 'ev-upload' }); form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }) }),
            copyValues: () => root.findAll((n) => n.props && n.props['data-testid'] && String(n.props['data-testid']).startsWith('copy-visual-prompt') && n.type === 'button').map((n) => n.props['data-testid']),
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

const PROFILE_V2 = {
  id: 'profile-v2',
  name: 'EVOLUTUS_FITNESS_V2',
  version: 'v2',
  base_prompt: 'Estilo base V2.',
  negative_rules: 'Sem texto.',
}
const PROFILE_V1 = {
  id: 'profile-v1',
  name: 'EVOLUTUS_FITNESS_V1',
  version: 'v1',
  base_prompt: 'Estilo base V1.',
  negative_rules: 'Sem texto.',
}
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
  instructions: [
    'Deite no banco, segure a barra acima do peito com braços estendidos. Esta é a posição inicial.',
    'Desça a barra até o meio do peito.',
  ],
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
  assets: (extra.assets || []).map((asset) => ({
    mime_type: 'image/webp',
    byte_size: 1000,
    width: asset.role === 'thumbnail' ? 320 : 1024,
    height: asset.role === 'thumbnail' ? 320 : 1024,
    ...asset,
  })),
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
    upload: () => Promise.resolve({}),
    profile: () => Promise.resolve(PROFILE_V2),
    discard: () => {
      globalThis.__svc.sets = []
      return Promise.resolve({ complete: true })
    },
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
  assert.deepEqual(called('listVisualSets')[0], ['listVisualSets', 'ex-1', { history: false }])
  const text = page.text()
  assert.match(text, /Criar com IA/)
  assert.match(text, /Copiar prompt INICIAL/)
  assert.match(text, /Copiar prompt FINAL/)
  assert.doesNotMatch(text, /Copiar prompt(?! INICIAL| FINAL)/, 'não há mais um prompt único')
  assert.match(text, /Formato do prompt/)
  assert.equal(page.select().props.value, 'generic', 'Genérico é o padrão')
  assert.deepEqual(
    page
      .select()
      .findAllByType('option')
      .map((o) => o.children.join('')),
    ['Genérico', 'Gemini', 'ChatGPT']
  )
  assert.match(text, /Sem imagem/)
  assert.doesNotMatch(text, /Aguardando revisão/, 'sem nada em revisão a seção não ocupa espaço')
  assert.match(text, /Histórico/)
  assert.equal(called('listVisualSets').length, 1)
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
  page.loadImages()
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
  page.loadImages()
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
  page.openHistory()
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
  page.loadImages()
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
  page.loadImages()
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
  assert.equal(args.metadata.promptVersion, 'v2.2')
  assert.equal(args.metadata.styleVersion, 'EVOLUTUS_FITNESS_V2')
  assert.equal(args.promptVersion, 'v2.2')
  assert.doesNotMatch(JSON.stringify(args), /gemini|google/i)
  page.unmount()
})

test('V2: dois botões de cópia (INICIAL e FINAL) e dois prompts separados, com a regra de uma imagem só', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.deepEqual(page.copyValues(), ['copy-visual-prompt-start', 'copy-visual-prompt-end'])
  const text = page.text()
  assert.match(text, /Ver prompt inicial/)
  assert.match(text, /Ver prompt final/)
  assert.match(text, /Gerar EXATAMENTE UMA imagem: a POSIÇÃO INICIAL \(START\)/)
  assert.match(text, /Gerar EXATAMENTE UMA imagem: a POSIÇÃO FINAL \(END\)/)
  assert.match(text, /deve ser utilizada como referência/)
  assert.equal(page.hasButton('Enviar imagens'), true, 'o envio continua')
  page.unmount()
})

test('V2: a dica de referência aparece clara quando a imagem inicial já está disponível', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.doesNotMatch(
    page.text(),
    /Use a imagem inicial como referência ao gerar a posição final\./
  )
  assert.match(
    page.text(),
    /Anexe a imagem inicial ao gerar a posição final\./,
    'dica discreta antes'
  )
  page.click(page.button('Enviar imagens'))
  page.pickFile('visual-start', 's.png')
  assert.match(page.text(), /Use a imagem inicial como referência ao gerar a posição final\./)
  page.unmount()
})

test('V2: trocar o formato muda os dois prompts e é registrado como provider hint; nada além do formato muda', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  page.setProvider('gemini')
  assert.match(page.text(), /Gere a imagem descrita neste briefing\./)
  assert.match(page.text(), /anexada a esta mensagem/)
  assert.match(page.text(), /Anexe a imagem inicial na mesma conversa do Gemini/)
  page.click(page.button('Enviar imagens'))
  page.pickFile('visual-start', 's.png')
  page.pickFile('visual-end', 'e.png')
  page.submitUpload()
  await tick()
  assert.equal(called('uploadVisualSet')[0][1].providerHint, 'gemini')
  page.setProvider('generic')
  assert.doesNotMatch(page.text(), /Gere a imagem descrita neste briefing\./)
  page.unmount()
})

test('V2: o envio registra proveniência (hash SHA-256 de START e END, perfil, chave de idempotência)', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  page.click(page.button('Enviar imagens'))
  page.pickFile('visual-start', 's.png')
  page.pickFile('visual-end', 'e.png')
  page.submitUpload()
  await tick()
  const [, args] = called('uploadVisualSet')[0]
  assert.match(args.promptStartHash, /^[0-9a-f]{64}$/)
  assert.match(args.promptEndHash, /^[0-9a-f]{64}$/)
  assert.notEqual(args.promptStartHash, args.promptEndHash)
  assert.equal(args.providerHint, 'generic')
  assert.equal(args.requestId, 'req-1')
  assert.equal(
    args.styleProfileId,
    'profile-v2',
    'o perfil registrado é o mesmo que gerou o prompt'
  )
  assert.doesNotMatch(JSON.stringify(args), /key|secret|token|password/i)
  page.unmount()
})

test('V2: duplo clique em "Enviar para revisão" dispara UM envio só', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  page.click(page.button('Enviar imagens'))
  page.pickFile('visual-start', 's.png')
  page.pickFile('visual-end', 'e.png')
  page.submitUploadTwice()
  await tick()
  assert.equal(called('uploadVisualSet').length, 1)
  page.unmount()
})

test('V2: retry com os mesmos arquivos reutiliza a chave; erro definitivo, ou arquivos novos, geram chave nova', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  page.click(page.button('Enviar imagens'))
  page.pickFile('visual-start', 's.png')
  page.pickFile('visual-end', 'e.png')
  const files = () => called('uploadVisualSet').map(([, args]) => args.requestId)

  globalThis.__svc.upload = () => Promise.reject(new TypeError('Failed to fetch'))
  page.submitUpload()
  await tick()
  page.submitUpload()
  await tick()
  assert.deepEqual(files(), ['req-1', 'req-1'], 'falha de rede: a mesma chave')

  globalThis.__svc.upload = () =>
    Promise.reject(Object.assign(new Error('INVALID_IMAGE'), { definitive: true }))
  page.submitUpload()
  await tick()
  page.submitUpload()
  await tick()
  assert.deepEqual(
    files(),
    ['req-1', 'req-1', 'req-1', 'req-2'],
    'depois de um erro definitivo a chave é renovada'
  )
  page.unmount()
})

test('V2: avisos automáticos aparecem na revisão sem bloquear a aprovação', async () => {
  globalThis.__svc.sets = [
    set('s2', 2, 'review', {
      assets: [{ role: 'start' }, { role: 'end' }, { role: 'thumbnail' }],
      metadata: {
        validation: { warnings: ['START_END_NEARLY_IDENTICAL', 'DUPLICATE_FILE_IN_OTHER_SET'] },
      },
    }),
  ]
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.match(page.text(), /muito parecidos/)
  assert.match(page.text(), /usado em outra versão/)
  page.loadImages()
  page.checkAll()
  assert.equal(page.button('Aprovar e publicar').props.disabled, false)
  page.unmount()
})

test('V2: histórico mostra a proveniência (estilo, prompt, formato) e o motivo de falha', async () => {
  globalThis.__svc.sets = [
    set('s2', 2, 'archived', {
      style_version: 'v2',
      prompt_version: 'v2',
      provider_hint: 'openai',
    }),
    set('s1', 1, 'failed', { metadata: { failure: { reason: 'EXPIRED' } } }),
  ]
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  page.openHistory()
  await tick()
  assert.match(page.text(), /estilo v2 · prompt v2 · formato ChatGPT/)
  assert.match(page.text(), /Falha: EXPIRED/)
  page.unmount()
})

const ERROR_TEXT = /Não foi possível carregar o padrão visual\. Tente novamente\./
const failProfile = () => Promise.reject(new TypeError('Failed to fetch'))

test('perfil carregado: prompts e envio funcionam, sem aviso de erro', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.doesNotMatch(page.text(), ERROR_TEXT)
  assert.equal(page.hasButton('Tentar novamente'), false)
  assert.match(page.text(), /Estilo visual: EVOLUTUS_FITNESS_V2 \(v2\)/)
  assert.equal(page.button('Enviar imagens').props.disabled, false)
  page.unmount()
})

test('falha ao carregar o perfil: sem prompts, sem cópia, sem envio; erro compacto com "Tentar novamente"', async () => {
  globalThis.__svc.profile = failProfile
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.match(page.text(), ERROR_TEXT)
  assert.equal(page.hasButton('Tentar novamente'), true)
  assert.equal(page.button('Copiar prompt INICIAL').props.disabled, true)
  assert.equal(page.button('Copiar prompt FINAL').props.disabled, true)
  assert.equal(page.button('Enviar imagens').props.disabled, true)
  assert.doesNotMatch(page.text(), /Estilo visual:|EXATAMENTE UMA imagem|Ver prompt/)
  assert.equal(page.select(), undefined, 'sem seletor de formato sem prompt')
  assert.deepEqual(called('uploadVisualSet'), [])
  page.unmount()
})

test('perfil ausente (nenhum ativo no servidor) é tratado como erro, nunca como perfil de reserva', async () => {
  globalThis.__svc.profile = () => Promise.resolve(null)
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.match(page.text(), ERROR_TEXT)
  assert.equal(page.button('Enviar imagens').props.disabled, true)
  globalThis.__svc.profile = () => Promise.resolve({ ...PROFILE_V2, id: null })
  page.click(page.button('Tentar novamente'))
  await tick()
  assert.match(page.text(), ERROR_TEXT, 'perfil sem id também não vale')
  page.unmount()
})

test('"Tentar novamente" com sucesso: prompts e criação voltam a funcionar', async () => {
  globalThis.__svc.profile = failProfile
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.equal(page.button('Enviar imagens').props.disabled, true)
  globalThis.__svc.profile = () => Promise.resolve(PROFILE_V2)
  page.click(page.button('Tentar novamente'))
  await tick()
  assert.doesNotMatch(page.text(), ERROR_TEXT)
  assert.equal(called('getActiveStyleProfile').length, 2)
  assert.deepEqual(page.copyValues(), ['copy-visual-prompt-start', 'copy-visual-prompt-end'])
  assert.match(page.text(), /Estilo visual: EVOLUTUS_FITNESS_V2 \(v2\)/)
  page.click(page.button('Enviar imagens'))
  page.pickFile('visual-start', 's.png')
  page.pickFile('visual-end', 'e.png')
  page.submitUpload()
  await tick()
  assert.equal(called('uploadVisualSet').length, 1)
  page.unmount()
})

test('com o perfil indisponível, imagens publicadas, histórico, revisão e rollback continuam funcionando', async () => {
  globalThis.__svc.profile = failProfile
  globalThis.__svc.sets = [
    set('s4', 4, 'published'),
    set('s3', 3, 'review', { assets: [{ role: 'start' }, { role: 'end' }, { role: 'thumbnail' }] }),
    set('s2', 2, 'archived'),
  ]
  const page = mount()
  await tick()
  assert.match(page.text(), /Supino reto/, 'a lista do catálogo não depende do perfil')
  page.click(page.rowButtons()[0])
  await tick()
  page.openHistory()
  await tick()
  const text = page.text()
  assert.match(text, ERROR_TEXT)
  assert.match(text, /Publicada · v4/)
  assert.match(text, /Versão 3 em revisão/)
  assert.match(text, /Histórico \(3\)/)
  assert.equal(page.button('Restaurar esta versão (rollback)').props.disabled, false)
  page.loadImages()
  page.checkAll()
  assert.equal(page.button('Aprovar e publicar').props.disabled, false)
  page.click(page.button('Restaurar esta versão (rollback)'))
  await tick()
  assert.deepEqual(called('restoreVisualSet')[0], ['restoreVisualSet', 's2'])
  page.click(page.button('Aprovar e publicar'))
  await tick()
  assert.deepEqual(called('publishVisualSet')[0], ['publishVisualSet', 's3'])
  page.unmount()
})

test('proveniência: o prompt mostrado e o conjunto registrado vêm do MESMO perfil (V1 ativo => V1 em tudo)', async () => {
  globalThis.__svc.profile = () => Promise.resolve(PROFILE_V1)
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  const text = page.text()
  assert.match(text, /Estilo visual: EVOLUTUS_FITNESS_V1 \(v1\)/)
  assert.doesNotMatch(text, /EVOLUTUS_FITNESS_V2|Estilo base V2/)
  page.click(page.button('Enviar imagens'))
  page.pickFile('visual-start', 's.png')
  page.pickFile('visual-end', 'e.png')
  page.submitUpload()
  await tick()
  const [, args] = called('uploadVisualSet')[0]
  assert.equal(args.styleProfileId, 'profile-v1')
  assert.equal(args.metadata.styleVersion, 'EVOLUTUS_FITNESS_V1')
  assert.doesNotMatch(JSON.stringify(args), /V2|profile-v2/)
  page.unmount()
})

test('confirmação humana única nunca aprova antes de abrir os arquivos e bloqueia erro de imagem', async () => {
  globalThis.__svc.sets = [
    set('review', 3, 'review', { assets: [{ role: 'start' }, { role: 'end' }] }),
  ]
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.equal(page.reviewChecks().length, 1)
  page.checkAll()
  assert.equal(page.button('Aprovar e publicar').props.disabled, true)
  page.loadImages()
  assert.equal(page.button('Aprovar e publicar').props.disabled, false)
  page.imageError()
  assert.equal(page.button('Aprovar e publicar').props.disabled, true)
  page.unmount()
})
test('rejeição rápida mantém histórico sem recarregar catálogo/cobertura', async () => {
  globalThis.__svc.sets = [
    set('review', 3, 'review', { assets: [{ role: 'start' }, { role: 'end' }] }),
  ]
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  const listReads = called('listCatalogForVisuals').length,
    coverageReads = called('getVisualCoverage').length
  page.click(page.button('Rejeitar'))
  page.rejectReason('Imagem sem relação com exercício')
  page.click(page.button('Confirmar rejeição'))
  await tick()
  assert.deepEqual(called('rejectVisualSet')[0], [
    'rejectVisualSet',
    'review',
    'Imagem sem relação com exercício',
  ])
  assert.equal(called('listCatalogForVisuals').length, listReads)
  assert.equal(called('getVisualCoverage').length, coverageReads)
  page.openHistory()
  await tick()
  assert.match(page.text(), /Motivo: Imagem sem relação com exercício/)
  page.unmount()
})
test('exclusão deliberada não é confundida com rejeição e pendência oferece retry no histórico', async () => {
  globalThis.__svc.sets = [
    set('review', 3, 'review', { assets: [{ role: 'start' }, { role: 'end' }] }),
  ]
  globalThis.__svc.discard = () => {
    globalThis.__svc.sets = []
    globalThis.__svc.deletions = [{ visual_set_id: 'review', version: 3, status: 'pending' }]
    return Promise.resolve({ complete: false })
  }
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.equal(called('deleteVisualSet').length, 0)
  page.click(page.button('Excluir versão'))
  assert.equal(called('deleteVisualSet').length, 0)
  page.click(page.button('Confirmar exclusão'))
  await tick()
  assert.equal(called('deleteVisualSet').length, 1)
  assert.match(page.text(), /Exclusão dos arquivos pendente/)
  assert.doesNotMatch(page.text(), /Versão 3 em revisão/)
  assert.equal(called('rejectVisualSet').length, 0)
  page.openHistory()
  await tick()
  assert.equal(page.hasButton('Reprocessar exclusão'), true)
  page.unmount()
})
test('FINAL pode ser copiado, mantém referência START obrigatória e histórico sob demanda', async () => {
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.equal(page.button('Copiar prompt FINAL').props.disabled, false)
  assert.match(page.text(), /REFERÊNCIA OBRIGATÓRIA/)
  assert.match(page.text(), /Anexe a imagem inicial ao gerar a posição final/)
  assert.equal(called('listVisualSets').length, 1)
  page.openHistory()
  await tick()
  assert.equal(called('listVisualSets').length, 2)
  assert.equal(called('listVisualSets')[1][2].history, true)
  page.unmount()
})

test('resposta perdida após a exclusão revalida o estado e nunca mantém versão removida em revisão', async () => {
  globalThis.__svc.sets = [
    set('review', 3, 'review', { assets: [{ role: 'start' }, { role: 'end' }] }),
  ]
  globalThis.__svc.discard = () => {
    globalThis.__svc.sets = []
    globalThis.__svc.deletions = [{ visual_set_id: 'review', version: 3, status: 'pending' }]
    return Promise.reject(new Error('resposta perdida'))
  }
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  page.click(page.button('Excluir versão'))
  page.click(page.button('Confirmar exclusão'))
  await tick()
  assert.doesNotMatch(page.text(), /Versão 3 em revisão/)
  assert.match(page.text(), /Há arquivos com exclusão pendente/)
  page.openHistory()
  await tick()
  assert.equal(page.hasButton('Reprocessar exclusão'), true)
  page.unmount()
})

test('instruções incompletas informam sem bloquear cópia nem relaxar a revisão', async () => {
  globalThis.__svc.catalog = {
    data: [{ ...EXERCISE, instructions: ['Contraia o peitoral.'] }],
    total: 1,
  }
  globalThis.__svc.sets = [
    set('review', 3, 'review', { assets: [{ role: 'start' }, { role: 'end' }] }),
  ]
  const page = mount()
  await tick()
  page.click(page.rowButtons()[0])
  await tick()
  assert.equal(page.button('Copiar prompt INICIAL').props.disabled, false)
  assert.equal(page.button('Copiar prompt FINAL').props.disabled, false)
  assert.match(page.text(), /Instruções incompletas. Confira a execução antes de gerar/)
  assert.match(page.text(), /Contraia o peitoral/)
  assert.match(page.text(), /REFERÊNCIA OBRIGATÓRIA/)
  assert.equal(page.button('Aprovar e publicar').props.disabled, true)
  page.checkAll()
  assert.equal(
    page.button('Aprovar e publicar').props.disabled,
    true,
    'human inspection still requires readable images'
  )
  page.unmount()
})
