import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// PR4b: painel completo do assistente de lançamento, montado diretamente (fora do
// limite de React.lazy/Suspense -- ver LaunchAssistant.test.js para o porquê). Cobre o
// fluxo real de ativação: reautenticação, confirmação explícita, falha parcial,
// idempotência de clique duplo e "nunca ativa nada automaticamente".
let directory
let mount
let calls

const primerRealPath = createRequire(import.meta.url).resolve('@primer/react')

const STUBS = {
  // react-test-renderer não suporta os Portals de DOM real que Dialog usa (sem jsdom
  // neste projeto -- não é uma dependência que vamos adicionar só para isto, ver
  // LaunchAssistant.test.js). Tudo o mais em @primer/react continua real; só Dialog
  // troca de um portal por um <div> simples com o mesmo contrato de props (title,
  // children, footerButtons, onClose) -- suficiente para testar a lógica de
  // reautenticação/confirmação/erro sem depender de DOM real. O fluxo visual completo
  // do diálogo (portal incluso) é coberto no navegador real pelo browser-smoke.
  '@primer/react': `
    import * as Real from ${JSON.stringify(primerRealPath)}
    export const Box = Real.Box
    export const Button = Real.Button
    export const Checkbox = Real.Checkbox
    export const Flash = Real.Flash
    export const FormControl = Real.FormControl
    export const Heading = Real.Heading
    export const Label = Real.Label
    export const Spinner = Real.Spinner
    export const Text = Real.Text
    export const TextInput = Real.TextInput
    export const ThemeProvider = Real.ThemeProvider
    export const BaseStyles = Real.BaseStyles
    import { createElement } from 'react'
    export function Dialog({ title, children, footerButtons = [] }) {
      return createElement('div', { 'data-testid': 'dialog' }, [
        createElement('h1', { key: 't' }, title),
        children,
        createElement('div', { key: 'f' }, footerButtons.map((b, i) =>
          createElement('button', { key: i, onClick: b.onClick, disabled: b.disabled }, b.content)
        )),
      ])
    }
  `,
  launchAssistantService: `
    export const getLaunchVerification = () => { globalThis.__laCalls.push('verify'); return globalThis.__laVerify() }
    export const activateOffering = (args) => { globalThis.__laCalls.push(['activateOffering', args]); return globalThis.__laActivateOffering(args) }
    export const activatePlacement = (args) => { globalThis.__laCalls.push(['activatePlacement', args]); return globalThis.__laActivatePlacement(args) }
  `,
  evocashPricingService: `export const reauthenticatePricingAdmin = (...args) => { globalThis.__laCalls.push(['reauth', ...args]); return globalThis.__laReauth() }`,
  authCaptcha: `export const authCaptchaRequired = false
    export function takeCaptchaToken() { return null }`,
  AuthCaptcha: `import { forwardRef } from 'react'
    export const AuthCaptcha = forwardRef(function AuthCaptcha(_props, ref) { return null })`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'launch-assistant-panel-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import LaunchAssistantPanel from './LaunchAssistantPanel.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n?.children || []).map(textOf).join(''))
        function nodes(tree, type) {
          if (!tree || typeof tree !== 'object') return []
          const children = tree.children
          return [
            ...(tree.type === type ? [tree] : []),
            ...(Array.isArray(children) ? children : [children]).flatMap((n) => nodes(n, type)),
          ]
        }
        export function mountPage(onClose) {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(MemoryRouter, null, React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(LaunchAssistantPanel, { onClose })))))
          })
          return {
            text: () => textOf(renderer.toJSON()),
            links: () => nodes(renderer.toJSON(), 'a').map((n) => ({ href: n.props.href, text: textOf(n) })),
            click: (label) => {
              const btn = nodes(renderer.toJSON(), 'button').find((n) => textOf(n).trim() === label)
              if (!btn) throw new Error('botão não encontrado: ' + label)
              act(() => { btn.props.onClick() })
            },
            // Clique duplo de verdade: o mesmo nó/handler disparado duas vezes antes de
            // qualquer nova renderização, não duas buscas por texto (que já falharia na
            // segunda, já que o rótulo muda para "Ativando…" assim que a primeira
            // chamada desliga o botão -- prova por si só a proteção, mas não é o que um
            // duplo clique real faria).
            clickTwice: (label) => {
              const btn = nodes(renderer.toJSON(), 'button').find((n) => textOf(n).trim() === label)
              if (!btn) throw new Error('botão não encontrado: ' + label)
              act(() => {
                btn.props.onClick()
                btn.props.onClick()
              })
            },
            setPassword: (value) => {
              const input = nodes(renderer.toJSON(), 'input').find((n) => n.props.type === 'password')
              act(() => { input.props.onChange({ target: { value } }) })
            },
            checkConfirm: () => {
              const input = nodes(renderer.toJSON(), 'input').find((n) => n.props.type === 'checkbox')
              act(() => { input.props.onChange({ target: { checked: true } }) })
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

function offeringItem(overrides = {}) {
  return {
    code: 'post_boost',
    name: 'Impulsionar publicação',
    integrationReady: true,
    salesEnabled: false,
    revision: '5',
    currentPrice: { unitPriceCash: '7', minDays: 1, maxDays: 5 },
    ...overrides,
  }
}

function placementItem(overrides = {}) {
  return {
    code: 'home_banner',
    name: 'Banner da Home',
    capacity: 10,
    sales_enabled: false,
    delivery_enabled: false,
    revision: 2,
    ...overrides,
  }
}

const BASE_READY = {
  supplier: { state: 'ready', value: true },
  evocash: { state: 'ready', value: { quotingEnabled: true, checkoutEnabled: true } },
  catalog: { state: 'ready', value: { items: [] } },
  inventory: { state: 'ready', value: { placements: [] } },
}

const PAUSED_OFFERING = {
  ...BASE_READY,
  catalog: { state: 'ready', value: { items: [offeringItem()] } },
}

function configure({
  verify = () => Promise.resolve(PAUSED_OFFERING),
  reauth = () => Promise.resolve(),
  activateOffering = () => Promise.resolve({}),
  activatePlacement = () => Promise.resolve({}),
} = {}) {
  calls = []
  globalThis.__laCalls = calls
  globalThis.__laVerify = verify
  globalThis.__laReauth = reauth
  globalThis.__laActivateOffering = activateOffering
  globalThis.__laActivatePlacement = activatePlacement
}

test('carrega automaticamente ao montar, sem clique nenhum', async () => {
  configure()
  const page = mount(() => {})
  await tick()
  assert.match(page.text(), /Impulsionar publicação/)
  assert.equal(calls.filter((c) => c === 'verify').length, 1)
  page.unmount()
})

test('nunca ativa nada automaticamente -- só carregar não chama nenhuma escrita', async () => {
  configure()
  const page = mount(() => {})
  await tick()
  assert.equal(
    calls.some((c) => Array.isArray(c) && c[0] === 'activateOffering'),
    false
  )
  page.unmount()
})

test('requisito pendente tem link direto para a configuração existente', async () => {
  configure({
    verify: () =>
      Promise.resolve({
        ...PAUSED_OFFERING,
        supplier: { state: 'ready', value: false },
      }),
  })
  const page = mount(() => {})
  await tick()
  const link = page.links().find((l) => l.text === 'Verificar fornecedor')
  assert.equal(link?.href, '/admin/parcerias?area=financeiro&tab=avancado')
  page.unmount()
})

test('"Verificar novamente" refaz a consulta', async () => {
  configure()
  const page = mount(() => {})
  await tick()
  page.click('Verificar novamente')
  await tick()
  assert.equal(calls.filter((c) => c === 'verify').length, 2)
  page.unmount()
})

test('"Fechar" chama onClose', async () => {
  configure()
  let closed = false
  const page = mount(() => {
    closed = true
  })
  await tick()
  page.click('Fechar')
  assert.equal(closed, true)
  page.unmount()
})

test('Ativar abre o diálogo e exige senha + confirmação explícita antes de habilitar o botão', async () => {
  configure()
  const page = mount(() => {})
  await tick()
  page.click('Ativar')
  assert.match(page.text(), /Confirme sua senha/)
  // Sem senha e sem confirmação, o botão de confirmação do diálogo ainda não deve
  // disparar a escrita.
  page.click('Confirmar ativação')
  await tick()
  assert.equal(
    calls.some((c) => Array.isArray(c) && c[0] === 'reauth'),
    false
  )
  page.unmount()
})

function offeringDone() {
  return {
    ...PAUSED_OFFERING,
    catalog: { state: 'ready', value: { items: [offeringItem({ salesEnabled: true })] } },
  }
}

test('ativação bem-sucedida: revalida (dado inalterado), escreve com revisão e justificativa, depois recarrega', async () => {
  let offeringCalls = 0
  configure({
    verify: () => {
      offeringCalls++
      // 1ª chamada: carregar ao montar. 2ª: revalidação imediatamente antes da escrita
      // (ainda pausado, nada mudou). 3ª: recarregar depois do sucesso.
      return Promise.resolve(offeringCalls <= 2 ? PAUSED_OFFERING : offeringDone())
    },
  })
  const page = mount(() => {})
  await tick()
  page.click('Ativar')
  page.setPassword('senha-correta')
  page.checkConfirm()
  page.click('Confirmar ativação')
  await tick()
  const [, activateArgs] = calls.find((c) => Array.isArray(c) && c[0] === 'activateOffering')
  assert.equal(activateArgs.code, 'post_boost')
  assert.equal(activateArgs.revision, 5)
  assert.equal(activateArgs.reason, 'Ativado via assistente de lançamento comercial.')
  assert.ok(activateArgs.requestId, 'idempotency key enviada')
  assert.equal(
    offeringCalls,
    3,
    'carrega, revalida antes de escrever, e recarrega depois de ativar'
  )
  assert.doesNotMatch(page.text(), /Confirme sua senha/, 'diálogo fechou após sucesso')
  page.unmount()
})

test('revalidação detecta mudança concorrente: não escreve com dado obsoleto, avisa e atualiza a lista', async () => {
  let offeringCalls = 0
  configure({
    verify: () => {
      offeringCalls++
      // O administrador abriu o diálogo vendo "pausado" (1ª chamada), mas entre abrir e
      // confirmar outra sessão já ativou o serviço -- a revalidação (2ª chamada) precisa
      // enxergar isso antes de qualquer escrita.
      return Promise.resolve(offeringCalls === 1 ? PAUSED_OFFERING : offeringDone())
    },
  })
  const page = mount(() => {})
  await tick()
  page.click('Ativar')
  page.setPassword('senha-correta')
  page.checkConfirm()
  page.click('Confirmar ativação')
  await tick()
  assert.equal(
    calls.some((c) => Array.isArray(c) && c[0] === 'activateOffering'),
    false,
    'nunca escreve com a elegibilidade antiga'
  )
  assert.doesNotMatch(
    page.text(),
    /Confirme sua senha/,
    'diálogo fechou -- não insiste com dado obsoleto'
  )
  assert.match(page.text(), /configuração mudou desde a última verificação/i)
  assert.match(
    page.text(),
    /concluído/,
    'a lista exibida já reflete o estado novo (serviço concluído)'
  )
  page.unmount()
})

test('serviço removido entre a consulta e a ativação também é tratado como mudança, não como ativação', async () => {
  let offeringCalls = 0
  configure({
    verify: () => {
      offeringCalls++
      return Promise.resolve(
        offeringCalls === 1
          ? PAUSED_OFFERING
          : { ...PAUSED_OFFERING, catalog: { state: 'ready', value: { items: [] } } }
      )
    },
  })
  const page = mount(() => {})
  await tick()
  page.click('Ativar')
  page.setPassword('senha-correta')
  page.checkConfirm()
  page.click('Confirmar ativação')
  await tick()
  assert.equal(
    calls.some((c) => Array.isArray(c) && c[0] === 'activateOffering'),
    false
  )
  assert.match(page.text(), /configuração mudou desde a última verificação/i)
  page.unmount()
})

test('reautenticação recusada nunca chama a RPC de ativação', async () => {
  configure({ reauth: () => Promise.reject(new Error('senha incorreta')) })
  const page = mount(() => {})
  await tick()
  page.click('Ativar')
  page.setPassword('senha-errada')
  page.checkConfirm()
  page.click('Confirmar ativação')
  await tick()
  assert.equal(
    calls.some((c) => Array.isArray(c) && c[0] === 'activateOffering'),
    false
  )
  assert.match(page.text(), /Confirme sua senha/, 'diálogo permanece aberto para nova tentativa')
  page.unmount()
})

test('falha na ativação mostra erro, mantém o diálogo aberto e não derruba o resto da página', async () => {
  let offeringCalls = 0
  configure({
    verify: () => {
      offeringCalls++
      return Promise.resolve(PAUSED_OFFERING)
    },
    activateOffering: () =>
      Promise.reject(Object.assign(new Error('x'), { message: 'PRICE_REVISION_CONFLICT' })),
  })
  const page = mount(() => {})
  await tick()
  page.click('Ativar')
  page.setPassword('senha-correta')
  page.checkConfirm()
  page.click('Confirmar ativação')
  await tick()
  assert.match(
    page.text(),
    /Confirme sua senha/,
    'diálogo continua aberto -- não houve sucesso geral falso'
  )
  assert.equal(
    offeringCalls,
    2,
    'carrega e revalida antes de escrever, mas não recarrega automaticamente depois de uma falha'
  )
  page.unmount()
})

test('clique duplo no confirmar não dispara duas ativações', async () => {
  let activations = 0
  configure({
    activateOffering: () => {
      activations++
      return new Promise((resolve) => setTimeout(() => resolve({}), 20))
    },
  })
  const page = mount(() => {})
  await tick()
  page.click('Ativar')
  page.setPassword('senha-correta')
  page.checkConfirm()
  page.clickTwice('Confirmar ativação')
  await tick()
  assert.equal(activations, 1)
  page.unmount()
})

function placementPaused(overrides = {}) {
  return {
    ...BASE_READY,
    inventory: { state: 'ready', value: { placements: [placementItem(overrides)] } },
  }
}

test('espaço com só contratações pausadas: um único botão "Ativar novas contratações"', async () => {
  configure({
    verify: () =>
      Promise.resolve(placementPaused({ sales_enabled: false, delivery_enabled: true })),
  })
  const page = mount(() => {})
  await tick()
  assert.match(page.text(), /Ativar novas contratações/)
  assert.doesNotMatch(page.text(), /Ativar exibição/)
  page.unmount()
})

test('espaço com só exibição pausada: um único botão "Ativar exibição"', async () => {
  configure({
    verify: () =>
      Promise.resolve(placementPaused({ sales_enabled: true, delivery_enabled: false })),
  })
  const page = mount(() => {})
  await tick()
  assert.match(page.text(), /Ativar exibição/)
  assert.doesNotMatch(page.text(), /Ativar novas contratações/)
  page.unmount()
})

test('espaço com os dois controles pausados: dois botões independentes', async () => {
  configure({
    verify: () =>
      Promise.resolve(placementPaused({ sales_enabled: false, delivery_enabled: false })),
  })
  const page = mount(() => {})
  await tick()
  assert.match(page.text(), /Ativar novas contratações/)
  assert.match(page.text(), /Ativar exibição/)
  page.unmount()
})

test('ativar só "novas contratações" preserva o valor atual de exibição e da capacidade', async () => {
  let placementCalls = 0
  let sentArgs
  configure({
    verify: () => {
      placementCalls++
      return Promise.resolve(
        placementPaused({ sales_enabled: false, delivery_enabled: true, capacity: 37 })
      )
    },
    activatePlacement: (args) => {
      sentArgs = args
      return Promise.resolve({})
    },
  })
  const page = mount(() => {})
  await tick()
  page.click('Ativar novas contratações')
  page.setPassword('senha-correta')
  page.checkConfirm()
  page.click('Confirmar ativação')
  await tick()
  assert.equal(sentArgs.code, 'home_banner')
  assert.equal(sentArgs.capacity, 37, 'capacidade nunca é alterada pela ativação')
  assert.equal(sentArgs.salesEnabled, true)
  assert.equal(
    sentArgs.deliveryEnabled,
    true,
    'exibição já estava ligada e permanece ligada -- não é desligada por engano'
  )
  assert.equal(placementCalls, 3, 'carrega, revalida antes de escrever, recarrega depois de ativar')
  page.unmount()
})

test('ativar só "exibição" preserva o valor atual de contratações', async () => {
  let sentArgs
  configure({
    verify: () =>
      Promise.resolve(
        placementPaused({ sales_enabled: true, delivery_enabled: false, capacity: 5 })
      ),
    activatePlacement: (args) => {
      sentArgs = args
      return Promise.resolve({})
    },
  })
  const page = mount(() => {})
  await tick()
  page.click('Ativar exibição')
  page.setPassword('senha-correta')
  page.checkConfirm()
  page.click('Confirmar ativação')
  await tick()
  assert.equal(sentArgs.deliveryEnabled, true)
  assert.equal(
    sentArgs.salesEnabled,
    true,
    'contratações já estavam ligadas e permanecem ligadas -- não são desligadas por engano'
  )
  page.unmount()
})

test('ativar um controle do espaço não chama a RPC de ofertas comerciais', async () => {
  configure({
    verify: () =>
      Promise.resolve(placementPaused({ sales_enabled: false, delivery_enabled: true })),
  })
  const page = mount(() => {})
  await tick()
  page.click('Ativar novas contratações')
  page.setPassword('senha-correta')
  page.checkConfirm()
  page.click('Confirmar ativação')
  await tick()
  assert.equal(
    calls.some((c) => Array.isArray(c) && c[0] === 'activateOffering'),
    false
  )
  page.unmount()
})

// --- resumo operacional exibido no painel -----------------------------------

test('painel mostra "Tudo pronto" só quando nada está pendente, pausado ou indisponível', async () => {
  configure({ verify: () => Promise.resolve(BASE_READY) })
  const page = mount(() => {})
  await tick()
  assert.match(page.text(), /Tudo pronto/)
  page.unmount()
})

test('painel nunca mostra "Tudo pronto" quando um serviço está pausado', async () => {
  configure()
  const page = mount(() => {})
  await tick()
  assert.doesNotMatch(page.text(), /Tudo pronto/)
  assert.match(page.text(), /pausado/)
  page.unmount()
})

test('painel mostra aviso de indisponibilidade quando uma fonte administrativa falha', async () => {
  configure({
    verify: () => Promise.resolve({ ...BASE_READY, inventory: { state: 'error', value: null } }),
  })
  const page = mount(() => {})
  await tick()
  assert.match(page.text(), /Não foi possível verificar todos os requisitos/)
  page.unmount()
})
