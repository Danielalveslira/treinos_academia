import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Reestruturação do assistente de publicidade (PROMPT_EVOLUTUS_REESTRUTURACAO_PUBLICIDADE.md,
// seção 5): três etapas, isolamento de rascunho por usuário/conta/modo/ID, imagem
// selecionável antes de qualquer persistência (com remoção real), e duração/preço validados
// contra a faixa real da oferta. Serviços de rede e StorefrontImage são stubs controlados
// pelo próprio teste (globalThis.__caw*); MarkdownField/AdvertisingCreativePreview são reais.
let directory
let mount

const STUBS = {
  advertisingService: `
    export const createAdvertisingCampaign = (accountId, values, requestId) =>
      globalThis.__cawCreate(accountId, values, requestId)
    export const editAdvertisingCampaign = (campaign, values, submit, desiredDays, clearMedia) =>
      globalThis.__cawEdit(campaign, values, submit, desiredDays, clearMedia)
    export const getAdvertisingSalesStatus = () => globalThis.__cawSales()
  `,
  communitiesService: `
    export const listActiveCommunities = (uid) => globalThis.__cawCommunities(uid)
  `,
  storefrontService: `
    export const uploadStorefrontImage = (id, file) => globalThis.__cawUpload(id, file)
  `,
  StorefrontImage: `export default function StorefrontImage() { return null }`,
  CommunityAdvertisingPermissions: `export default function CommunityAdvertisingPermissions() { return null }`,
  useAuth: `export function useAuth() { return { user: { uid: globalThis.__cawUid || 'user-1' } } }`,
  // Floating-ui/overlay positioning (Primer's ActionMenu, used by the "mais opções" button)
  // needs a real DOM (ResizeObserver/HTMLElement/getBoundingClientRect...) that
  // react-test-renderer never provides; MarkdownField's own suite already covers its
  // behavior in isolation, so these flow-level tests (image upload/removal, community
  // hydration, double-click, resume) stub it out and stay focused on CreateAdWizard itself.
  MarkdownField: `export function MarkdownField() { return null }`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'create-ad-wizard-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import CreateAdWizard from './CreateAdWizard.jsx'

        if (!globalThis.sessionStorage) {
          const store = new Map()
          globalThis.sessionStorage = {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
            clear: () => store.clear(),
          }
        }
        // Node's real URL.createObjectURL (when present) requires an actual Blob; tests pass
        // plain fake File-like objects, so this is always overridden, not just polyfilled.
        let __objectUrlCount = 0
        URL.createObjectURL = () => 'blob:fake-' + ++__objectUrlCount
        URL.revokeObjectURL = () => {}

        const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''))

        export function mountPage(props) {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          global.window.navigator = global.window.navigator || { platform: '', userAgent: 'node' }
          global.Element = global.Element || class Element {}
          global.ResizeObserver =
            global.ResizeObserver ||
            class ResizeObserver {
              observe() {}
              unobserve() {}
              disconnect() {}
            }
          let renderer
          act(() => {
            renderer = TestRenderer.create(
              React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(CreateAdWizard, props)))
            )
          })
          const root = renderer.root
          const findAllButtons = () => root.findAll((n) => n.type === 'button')
          const byLabelOrText = (label) =>
            findAllButtons().find((n) => textOf(n).trim() === label || n.props['aria-label'] === label)
          return {
            text: () => textOf(renderer.toJSON()),
            findButton: (label) => byLabelOrText(label),
            clickButton: (label) => {
              const item = byLabelOrText(label)
              act(() => item.props.onClick())
            },
            countButtons: (label) => findAllButtons().filter((n) => textOf(n).trim() === label).length,
            setValue: (ariaLabel, value) => {
              const item = root.findAll((n) =>
                ['input', 'textarea', 'select'].includes(n.type) && n.props['aria-label'] === ariaLabel
              )[0]
              act(() => item.props.onChange({ target: { value } }))
            },
            selectFile: (file) => {
              const item = root.findAll((n) => n.type === 'input' && n.props.type === 'file')[0]
              act(() => item.props.onChange({ target: { files: [file], value: '' } }))
            },
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

function tariffRow(code, { price = '7', minDays = 1, maxDays = 30, salesEnabled = true } = {}) {
  return { code, salesEnabled, tariff: salesEnabled ? { price, minDays, maxDays } : null }
}

test('três etapas: cria o rascunho só ao avançar da Etapa 2, e só então chega na Etapa 3', async () => {
  globalThis.__cawUid = 'user-a1'
  globalThis.__cawSales = () => Promise.resolve([tariffRow('home_banner')])
  globalThis.__cawCommunities = () => Promise.resolve([])
  let createCalls = 0
  globalThis.__cawCreate = () => {
    createCalls++
    return Promise.resolve('ad-new-1')
  }
  globalThis.__cawEdit = (campaign, values, submit) =>
    Promise.resolve({ version: (campaign.version || 1) + 1, state: submit ? 'submitted' : 'draft' })

  const page = mount({ accountId: 'acc-1', accountName: 'Minha marca' })
  await tick()
  assert.match(page.text(), /Etapa 1 de 3/)
  page.clickButton('Selecionar posicionamento Página inicial')
  page.clickButton('Avançar')
  assert.match(page.text(), /Etapa 2 de 3/)
  assert.equal(createCalls, 0, 'nenhuma campanha é criada só por entrar na Etapa 2')

  page.setValue('Nome e título do anúncio', 'Minha campanha')
  page.setValue('Link de destino', 'https://exemplo.com.br')
  page.clickButton('Avançar')
  await tick()
  assert.equal(createCalls, 1, 'o rascunho é criado ao avançar da Etapa 2, não antes')
  assert.match(page.text(), /Etapa 3 de 3/)
  page.unmount()
})

test('Etapa 2 nunca habilita avançar com um destino que não é HTTPS válido', async () => {
  globalThis.__cawUid = 'user-a2'
  globalThis.__cawSales = () => Promise.resolve([tariffRow('home_banner')])
  globalThis.__cawCommunities = () => Promise.resolve([])
  globalThis.__cawCreate = () => Promise.resolve('ad-new-2')
  globalThis.__cawEdit = () => Promise.resolve({ version: 2, state: 'draft' })

  const page = mount({ accountId: 'acc-2', accountName: 'Minha marca' })
  await tick()
  page.clickButton('Selecionar posicionamento Página inicial')
  page.clickButton('Avançar')
  page.setValue('Nome e título do anúncio', 'Minha campanha')
  page.setValue('Link de destino', 'http://sem-https.com')
  assert.equal(page.findButton('Avançar').props.disabled, true)
  page.setValue('Link de destino', 'https://user:pass@exemplo.com.br')
  assert.equal(
    page.findButton('Avançar').props.disabled,
    true,
    'credenciais embutidas na URL também bloqueiam o avanço'
  )
  page.setValue('Link de destino', 'https://exemplo.com.br')
  assert.equal(page.findButton('Avançar').props.disabled, false)
  page.unmount()
})

test('Etapa 3 nunca corrige silenciosamente uma duração fora da faixa real da oferta', async () => {
  globalThis.__cawUid = 'user-a3'
  globalThis.__cawSales = () => Promise.resolve([tariffRow('home_banner', { price: '7', minDays: 2, maxDays: 10 })])
  globalThis.__cawCommunities = () => Promise.resolve([])
  globalThis.__cawCreate = () => Promise.resolve('ad-new-3')
  globalThis.__cawEdit = (campaign, values, submit) =>
    Promise.resolve({ version: (campaign.version || 1) + 1, state: submit ? 'submitted' : 'draft' })

  const page = mount({ accountId: 'acc-3', accountName: 'Minha marca' })
  await tick()
  page.clickButton('Selecionar posicionamento Página inicial')
  page.clickButton('Avançar')
  page.setValue('Nome e título do anúncio', 'Minha campanha')
  page.setValue('Link de destino', 'https://exemplo.com.br')
  page.clickButton('Avançar')
  await tick()
  assert.match(page.text(), /Etapa 3 de 3/)

  page.setValue('Quantidade de dias', '')
  assert.match(page.text(), /Informe a quantidade de dias/)
  assert.equal(page.findButton('Enviar para aprovação').props.disabled, true)

  page.setValue('Quantidade de dias', '20')
  assert.match(page.text(), /Escolha um valor entre 2 e 10 dias/)
  assert.equal(
    page.findButton('Enviar para aprovação').props.disabled,
    true,
    '20 nunca é silenciosamente trocado por 10'
  )

  page.setValue('Quantidade de dias', '5')
  assert.doesNotMatch(page.text(), /Escolha um valor entre/)
  assert.equal(page.findButton('Enviar para aprovação').props.disabled, false)
  assert.match(page.text(), /Total estimado: 35 EvoCash/)
  page.unmount()
})

test('imagem local pendente nunca chama a rede; remover uma já enviada limpa a mídia no servidor', async () => {
  globalThis.__cawUid = 'user-a4'
  globalThis.__cawSales = () => Promise.resolve([tariffRow('community_feed')])
  globalThis.__cawCommunities = () => Promise.resolve([{ id: 'community-1', name: 'Comunidade X' }])
  globalThis.__cawCreate = () => Promise.resolve('ad-new-4')
  let uploadCalls = 0
  globalThis.__cawUpload = () => {
    uploadCalls++
    return Promise.resolve('media-1')
  }
  const editCalls = []
  globalThis.__cawEdit = (campaign, values, submit, desiredDays, clearMedia) => {
    editCalls.push({ values, clearMedia })
    return Promise.resolve({ version: (campaign.version || 1) + 1, state: submit ? 'submitted' : 'draft' })
  }

  const page = mount({ accountId: 'acc-4', accountName: 'Minha marca' })
  await tick()
  page.clickButton('Selecionar posicionamento Feed da comunidade')
  page.setValue('Comunidade que você administra', 'community-1')
  page.clickButton('Avançar')
  page.setValue('Nome e título do anúncio', 'Minha campanha')
  page.setValue('Link de destino', 'https://exemplo.com.br')

  page.selectFile({ name: 'foto.webp', type: 'image/webp' })
  await tick()
  assert.equal(uploadCalls, 0, 'selecionar o arquivo é só prévia local, nenhuma chamada de rede ainda')
  assert.match(page.text(), /Ainda não enviada/)

  page.clickButton('Remover imagem')
  assert.doesNotMatch(page.text(), /Ainda não enviada/)
  assert.equal(uploadCalls, 0, 'remover uma imagem ainda não enviada também não toca a rede')

  page.selectFile({ name: 'foto2.webp', type: 'image/webp' })
  page.clickButton('Avançar')
  await tick()
  assert.equal(uploadCalls, 1, 'o envio real só acontece ao avançar, coordenado com o rascunho')
  assert.equal(editCalls.at(-1).values.media_id, 'media-1')
  page.unmount()
})

test('remover uma imagem já confirmada no servidor usa p_clear_media, não um media_id vazio', async () => {
  globalThis.__cawUid = 'user-a5'
  globalThis.__cawSales = () => Promise.resolve([])
  globalThis.__cawCommunities = () => Promise.resolve([])
  const editCalls = []
  globalThis.__cawEdit = (campaign, values, submit, desiredDays, clearMedia) => {
    editCalls.push({ clearMedia })
    return Promise.resolve({ version: campaign.version + 1, state: 'draft' })
  }

  const page = mount({
    accountId: 'acc-5',
    accountName: 'Minha marca',
    existingDraft: {
      ad_id: 'ad-5',
      version: 3,
      title: 'Já aprovado',
      description: '',
      destination: 'https://exemplo.com.br',
      media_id: 'media-already-there',
      placements: [{ code: 'community_feed', context: 'community-5' }],
      tariff: { salesEnabled: true, price: '7', minDays: 1, maxDays: 30 },
    },
  })
  await tick()
  assert.match(page.text(), /Etapa 2 de 3/, 'edição começa direto na Etapa 2, local é imutável')
  page.clickButton('Remover imagem')
  await tick()
  assert.equal(editCalls.length, 1)
  assert.equal(editCalls[0].clearMedia, true)
  page.unmount()
})

test('editar hidrata a comunidade contratada (sem opção de trocar) e nunca mistura com outro rascunho em sessionStorage', async () => {
  globalThis.__cawUid = 'user-a6'
  globalThis.__cawSales = () => Promise.resolve([])
  globalThis.__cawCommunities = () => Promise.resolve([{ id: 'community-6', name: 'Comunidade Oficial' }])
  globalThis.__cawEdit = () => Promise.resolve({ version: 2, state: 'draft' })

  sessionStorage.setItem(
    'evolutus:ad-wizard:user-a6:acc-6:create',
    JSON.stringify({ step: 1, placement: 'home_banner', values: { title: 'LIXO DE OUTRA SESSÃO', description: '', destination: '', media_id: null } })
  )

  const page = mount({
    accountId: 'acc-6',
    accountName: 'Minha marca',
    existingDraft: {
      ad_id: 'ad-6',
      version: 1,
      title: 'Campanha real da comunidade',
      description: '',
      destination: 'https://exemplo.com.br',
      media_id: null,
      placements: [{ code: 'community_feed', context: 'community-6' }],
      tariff: { salesEnabled: true, price: '7', minDays: 1, maxDays: 30 },
    },
  })
  await tick()
  assert.match(page.text(), /Comunidade Oficial/, 'a comunidade contratada é exibida, hidratada do existingDraft')
  assert.doesNotMatch(page.text(), /LIXO DE OUTRA SESSÃO/, 'o sessionStorage de uma sessão de criação diferente nunca é lido ao editar')
  assert.doesNotMatch(
    page.text(),
    /Selecione sua comunidade/,
    'edição nunca oferece um seletor para trocar de comunidade -- o local contratado é só leitura'
  )
  page.unmount()
})

test('retomar: reabrir o assistente de criação restaura o progresso salvo na mesma conta/usuário', async () => {
  globalThis.__cawUid = 'user-a7'
  globalThis.__cawSales = () => Promise.resolve([tariffRow('home_banner')])
  globalThis.__cawCommunities = () => Promise.resolve([])
  globalThis.__cawCreate = () => Promise.resolve('ad-new-7')
  globalThis.__cawEdit = () => Promise.resolve({ version: 2, state: 'draft' })

  const first = mount({ accountId: 'acc-7', accountName: 'Minha marca' })
  await tick()
  first.clickButton('Selecionar posicionamento Página inicial')
  first.clickButton('Avançar')
  first.setValue('Nome e título do anúncio', 'Rascunho retomável')
  first.setValue('Link de destino', 'https://exemplo.com.br')
  await new Promise((resolve) => setTimeout(resolve, 700)) // aguarda o debounce de 600ms do save local
  first.unmount()

  const second = mount({ accountId: 'acc-7', accountName: 'Minha marca' })
  await tick()
  assert.match(second.text(), /Etapa 2 de 3/, 'retoma na etapa onde parou')
  assert.match(second.text(), /Rascunho retomável/, 'retoma o título digitado antes da interrupção')
  assert.equal(second.findButton('Avançar').props.disabled, false)
  second.unmount()
})

test('clique duplo em Avançar da Etapa 2 cria a campanha uma única vez', async () => {
  globalThis.__cawUid = 'user-a8'
  globalThis.__cawSales = () => Promise.resolve([tariffRow('home_banner')])
  globalThis.__cawCommunities = () => Promise.resolve([])
  let createCalls = 0
  globalThis.__cawCreate = () =>
    new Promise((resolve) => setTimeout(() => { createCalls++; resolve('ad-new-8') }, 20))
  globalThis.__cawEdit = (campaign) => Promise.resolve({ version: (campaign.version || 1) + 1, state: 'draft' })

  const page = mount({ accountId: 'acc-8', accountName: 'Minha marca' })
  await tick()
  page.clickButton('Selecionar posicionamento Página inicial')
  page.clickButton('Avançar')
  page.setValue('Nome e título do anúncio', 'Minha campanha')
  page.setValue('Link de destino', 'https://exemplo.com.br')
  page.clickButton('Avançar')
  page.clickButton('Avançar')
  await tick(); await tick()
  assert.equal(createCalls, 1, 'o lock de envio impede uma segunda criação por clique duplicado')
  page.unmount()
})
