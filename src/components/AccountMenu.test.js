import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// AccountMenu.jsx puxa useAuth/useColorMode/usePendingNotice (que por sua vez puxam
// Supabase/@primer -- fora de escopo aqui) -- trocados por fixtures em memória via esbuild,
// mesmo padrão já usado em Exercises.test.js/RowActionsMenu.test.js.
//
// O Overlay do ActionMenu (AccountMenu) é portalado via createPortal pra um nó real de
// DOM (ver Portal.js do Primer) -- react-dom rejeita um container que não seja um elemento
// de DOM de verdade ("Target container is not a DOM element"), e este projeto não tem
// jsdom (decisão deliberada, testes em Node puro). RowActionsMenu.test.js já documenta essa
// mesma limitação pro mesmo componente do Primer: não dá pra montar o Overlay ABERTO aqui.
// Por isso os itens/seções do menu (renderNavItems/renderSessionItems/renderAdminSection)
// são exportados de AccountMenu.jsx como funções PURAS que devolvem elementos React ainda
// não montados -- testáveis direto, inspecionando `.props`, sem precisar montar o Overlay.
let directory
let mod

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'account-menu-tests-'))
  const outfile = join(directory, 'menu.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import {
          AccountMenu,
          ACCOUNT_ITEMS,
          ADMIN_ITEMS,
          renderNavItems,
          renderMobileWalletItem,
          renderSessionItems,
          renderAdminSection,
        } from './AccountMenu.jsx'
        import { authState } from '../hooks/useAuth'

        export { authState, ACCOUNT_ITEMS, ADMIN_ITEMS, renderNavItems, renderMobileWalletItem, renderSessionItems, renderAdminSection }

        // AccountMenu lê window.matchMedia num useState lazy, já na primeira renderização
        // (mesmo sob renderToStaticMarkup, que não roda efeitos mas roda o corpo da função).
        global.window = {
          matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        }

        export const renderTrigger = (props) =>
          renderToStaticMarkup(
            createElement(ThemeProvider, null,
              createElement(BaseStyles, null,
                createElement(MemoryRouter, null,
                  createElement(AccountMenu, {
                    onLogout: () => {},
                    onLogoutAll: () => {},
                    signingOut: false,
                    ...props,
                  })
                )
              )
            )
          )
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
        name: 'account-menu-fixtures',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/hooks\/useAuth$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture-auth',
          }))
          pluginBuild.onResolve({ filter: /\/hooks\/useColorMode$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture-color-mode',
          }))
          pluginBuild.onResolve({ filter: /\/hooks\/usePendingNotice$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture-notice',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-auth' }, () => ({
            contents: `
              export const authState = { isSuperAdmin: false, profile: {} }
              export function useAuth() { return authState }
            `,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-color-mode' }, () => ({
            contents: `export function useColorMode() { return { dark: false, toggleColorMode: () => {} } }`,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture-notice' }, () => ({
            contents: `export function useLogoutNotice() { return '' }`,
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  mod = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

// -- Gatilho (estado fechado) --------------------------------------------------------

test('trigger button renders closed, with the accessible label and no menu content yet', () => {
  mod.authState.isSuperAdmin = true
  mod.authState.profile = {}
  const html = mod.renderTrigger()
  assert.match(html, /aria-label="Menu da conta"/)
  assert.match(html, /aria-haspopup="true"/)
  assert.match(html, /aria-expanded="false"/)
  // Limitação conhecida (ver RowActionsMenu.test.js): o Overlay do Primer é portalado pra
  // um nó real de DOM, então o conteúdo do menu nunca aparece aqui -- só o gatilho fechado.
  assert.doesNotMatch(html, /Meu perfil/)
})

// -- Visibilidade por perfil (Cuidado: nenhuma rota some entre desktop/mobile) --------

test('ACCOUNT_ITEMS: "Minha vitrine" só aparece fora do perfil "common"; os demais itens são incondicionais', () => {
  const vitrine = mod.ACCOUNT_ITEMS.find((item) => item.key === 'vitrine')
  assert.equal(vitrine.show({ usageProfile: 'common' }), false)
  assert.equal(vitrine.show({ usageProfile: 'professional' }), true)
  assert.equal(vitrine.show(undefined), true)
  for (const item of mod.ACCOUNT_ITEMS) {
    if (item.key === 'vitrine') continue
    assert.equal(item.show, undefined, `"${item.label}" não devia ter condição`)
  }
})

test('renderNavItems aplica o filtro "show" e preserva rota/ícone/onClick por item', () => {
  const onNavigate = () => {}
  const common = mod.renderNavItems(mod.ACCOUNT_ITEMS, { usageProfile: 'common' }, onNavigate)
  const pro = mod.renderNavItems(mod.ACCOUNT_ITEMS, { usageProfile: 'professional' }, onNavigate)
  assert.equal(common.length, mod.ACCOUNT_ITEMS.length - 1)
  assert.equal(pro.length, mod.ACCOUNT_ITEMS.length)
  assert.equal(
    common.some((el) => el.props.to === '/minha-vitrine'),
    false
  )
  assert.equal(
    pro.some((el) => el.props.to === '/minha-vitrine'),
    true
  )
  for (const el of pro) {
    assert.equal(el.props.onClick, onNavigate)
    assert.equal(el.props.replace, true)
  }
})

test('carteira aparece só no grupo mobile e fecha o menu ao navegar', () => {
  let closed = false
  const item = mod.renderMobileWalletItem(() => {
    closed = true
  })
  assert.equal(item.props.to, '/entenda-suas-moedas')
  assert.equal(item.props.replace, true)
  assert.equal(item.props.children[1], 'Carteira e moedas')
  item.props.onClick()
  assert.equal(closed, true)
  assert.equal(
    mod.ACCOUNT_ITEMS.some((entry) => entry.to === '/entenda-suas-moedas'),
    false
  )
})

test('ADMIN_ITEMS continua com as mesmas 9 rotas administrativas', () => {
  assert.equal(mod.ADMIN_ITEMS.length, 9)
  const routes = mod.ADMIN_ITEMS.map((item) => item.to)
  assert.deepEqual(routes, [
    '/admin/comunidades',
    '/admin/parcerias',
    '/admin/contas',
    '/admin/exclusao-contas',
    '/admin/moderacao',
    '/admin/vitrines',
    '/admin/compras-evocash',
    '/admin/promocoes',
    '/admin/exercicios-imagens',
  ])
})

// -- Expansão da seção Administração (Cuidados 3 e 5) ---------------------------------

test('renderAdminSection: recolhida por padrão não expõe as 9 rotas; expandida, expõe', () => {
  const collapsed = mod.renderAdminSection({
    expanded: false,
    onToggle: () => {},
    profile: {},
    onNavigate: () => {},
  })
  const [trigger, hiddenWrapper] = collapsed.props.children
  assert.equal(trigger.props['aria-expanded'], false)
  assert.equal(trigger.props['aria-controls'], 'account-menu-admin-list')
  assert.equal(hiddenWrapper.props.hidden, true)
  assert.equal(hiddenWrapper.props.id, 'account-menu-admin-list')
  assert.equal(hiddenWrapper.props.children.length, 9)

  const expanded = mod.renderAdminSection({
    expanded: true,
    onToggle: () => {},
    profile: {},
    onNavigate: () => {},
  })
  const [expandedTrigger, expandedWrapper] = expanded.props.children
  assert.equal(expandedTrigger.props['aria-expanded'], true)
  assert.equal(expandedWrapper.props.hidden, false)
})

test('selecionar o item "Administração" alterna o estado sem fechar o menu inteiro (preventDefault)', () => {
  let toggled = false
  let prevented = false
  const section = mod.renderAdminSection({
    expanded: false,
    onToggle: () => {
      toggled = true
    },
    profile: {},
    onNavigate: () => {},
  })
  const [trigger] = section.props.children
  trigger.props.onSelect({
    preventDefault: () => {
      prevented = true
    },
  })
  assert.equal(toggled, true)
  assert.equal(prevented, true)
})

test('cada rota administrativa expandida ainda fecha o menu ao ser escolhida (Cuidado 5)', () => {
  let closed = false
  const section = mod.renderAdminSection({
    expanded: true,
    onToggle: () => {},
    profile: {},
    onNavigate: () => {
      closed = true
    },
  })
  const [, hiddenWrapper] = section.props.children
  for (const item of hiddenWrapper.props.children) {
    closed = false
    item.props.onClick()
    assert.equal(closed, true, `item para "${item.props.to}" não fecha o menu ao navegar`)
  }
})

// -- Logout (Cuidado 2: "Sair de todos os dispositivos" nunca usa preventDefault) -----

test('"Sair da conta" chama onLogout com preventDefault (mantém o menu aberto durante o signOut)', () => {
  let loggedOut = false
  let prevented = false
  const [signOut] = mod.renderSessionItems({
    onLogout: () => {
      loggedOut = true
    },
    onLogoutAll: () => {},
    signingOut: false,
    logoutNotice: '',
  }).props.children
  signOut.props.onSelect({
    preventDefault: () => {
      prevented = true
    },
  })
  assert.equal(loggedOut, true)
  assert.equal(prevented, true)
})

test('"Sair de todos os dispositivos" chama onLogoutAll SEM preventDefault -- o fechamento padrão do menu precisa acontecer antes da confirmação', () => {
  let loggedOutAll = false
  const [, signOutAll] = mod.renderSessionItems({
    onLogout: () => {},
    onLogoutAll: () => {
      loggedOutAll = true
    },
    signingOut: false,
    logoutNotice: '',
  }).props.children
  // Objeto sem preventDefault de propósito: se o código chamasse event.preventDefault(),
  // isso lançaria TypeError e o teste falharia -- passar confirma que não chama.
  signOutAll.props.onSelect({})
  assert.equal(loggedOutAll, true)
})

test('"Sair da conta" mostra "Saindo…" e fica desabilitado durante signingOut', () => {
  const [signOut] = mod.renderSessionItems({
    onLogout: () => {},
    onLogoutAll: () => {},
    signingOut: true,
    logoutNotice: '',
  }).props.children
  assert.equal(signOut.props.disabled, true)
  assert.equal(signOut.props.children[1], 'Saindo…')
})

test('aviso de logout pendente (offline) aparece como descrição do item "Sair da conta" quando presente', () => {
  const [signOut] = mod.renderSessionItems({
    onLogout: () => {},
    onLogoutAll: () => {},
    signingOut: false,
    logoutNotice: 'Você tem treinos não sincronizados.',
  }).props.children
  const description = signOut.props.children[2]
  assert.equal(description.props.children, 'Você tem treinos não sincronizados.')
})
