import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Integração da página: renderiza AdminAccounts com um Supabase falso que conta cada RPC e
// exercita o orçamento de leituras do prompt (1 por Atualizar; 0 para busca/filtro/ordenação/
// abas/painel/CSV).
let directory
let h
const repoRoot = new URL('../../', import.meta.url).pathname

const row = (n, patch = {}) => ({
  id: `00000000-0000-0000-0000-00000000000${n}`,
  username: `user${n}`,
  email: `user${n}@example.com`,
  role: 'user',
  status: 'active',
  created_at: `2026-0${n}-01T00:00:00Z`,
  last_sign_in_at: `2026-10-0${n}T00:00:00Z`,
  last_active_at: `2026-10-0${n}T12:00:00Z`,
  community_count: n,
  financial_status: 'none',
  flags_count: 0,
  showcase_status: 'none',
  deletion_status: 'none',
  accepted_legal_version: '1.4.0',
  restriction_action: null,
  restriction_until: null,
  disabled_reason: null,
  ...patch,
})

function snapshot(accounts, generatedAt = '2026-10-10T12:00:00Z') {
  return {
    generated_at: generatedAt,
    metrics: {
      total_accounts: accounts.length,
      active_accounts: accounts.filter((a) => a.status === 'active').length,
      suspended_accounts: 0,
      new_accounts_7d: 0,
      pending_deletions: 0,
    },
    meta: {
      total: accounts.length,
      returned: accounts.length,
      truncated: false,
      max_snapshot_rows: 1000,
    },
    accounts,
  }
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'admin-accounts-page-tests-'))
  const outfile = join(directory, 'page.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import AdminAccounts from './AdminAccounts.jsx'

        export function mount() {
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({
            matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          }))
          global.window.navigator = global.window.navigator || { platform: 'Linux', userAgent: 'node' }
          global.window.addEventListener = global.window.addEventListener || (() => {})
          global.window.removeEventListener = global.window.removeEventListener || (() => {})
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(
              createElement(ThemeProvider, null,
                createElement(BaseStyles, null,
                  createElement(MemoryRouter, null, createElement(AdminAccounts)))))
          })
          const root = renderer.root
          const flat = (inst) =>
            inst.children.map((c) => (typeof c === 'string' ? c : flat(c))).join('')
          const tick = () => new Promise((resolve) => setTimeout(resolve, 15))
          // O Spinner do Primer acrescenta o texto "Loading" ao botão: cai para "termina com"/"começa com" (cartões: rótulo + número).
          const findButton = (label) => {
            const buttons = root.findAll((n) => n.type === 'button')
            return (
              buttons.find((n) => n.props['aria-label'] === label || flat(n) === label) ||
              buttons.find((n) => flat(n).endsWith(label)) ||
              buttons.find((n) => flat(n).startsWith(label))
            )
          }
          const event = { stopPropagation() {}, preventDefault() {} }
          // async act() trava neste ambiente (ver CopyButton.test.js): dispara o handler e
          // espera um tick para as Promises e re-renderizações assentarem.
          return {
            text: () => flat(renderer.root),
            tick,
            async press(label) {
              const target = findButton(label)
              if (!target) throw new Error('botão não encontrado: ' + label)
              target.props.onClick(event)
              await tick()
            },
            async type(ariaLabel, value) {
              const input = root.find((n) => n.type === 'input' && n.props['aria-label'] === ariaLabel)
              input.props.onChange({ target: { value } })
              await tick()
            },
            rows: () => root.findAll((n) => n.props['data-testid'] === 'account-row' && typeof n.type === 'string'),
            async check(ariaLabel) {
              const box = root.find((n) => n.type === 'input' && n.props['aria-label'] === ariaLabel)
              box.props.onChange({ target: { checked: true } })
              await tick()
            },
            async typeReason(value) {
              const area = root.find((n) => n.type === 'textarea')
              area.props.onChange({ target: { value } })
              await tick()
            },
            async clickRow(i) {
              this.rows()[i].props.onClick(event)
              await tick()
            },
            isDisabled(label) {
              const target = findButton(label)
              return target ? Boolean(target.props.disabled) : null
            },
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    logLevel: 'silent',
    plugins: [
      {
        // Overlays do Primer (ActionMenu/AnchoredOverlay) exigem DOM real; aqui só os menus são
        // trocados por stubs inertes -- o resto do Primer continua real.
        name: 'primer-overlay-stubs',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^@primer\/react$/ }, async (args) => {
            if (args.pluginData?.real) return undefined
            const real = await pluginBuild.resolve('@primer/react', {
              resolveDir: args.resolveDir,
              kind: args.kind,
              pluginData: { real: true },
            })
            return {
              path: 'primer-stub',
              namespace: 'primer-stub',
              pluginData: { realPath: real.path },
            }
          })
          pluginBuild.onLoad({ filter: /.*/, namespace: 'primer-stub' }, (args) => ({
            resolveDir: repoRoot,
            contents: `
              import * as real from ${JSON.stringify(args.pluginData.realPath)}
              export * from ${JSON.stringify(args.pluginData.realPath)}
              import { createElement } from 'react'
              const Pass = ({ children }) => children
              // Dialog do Primer usa portal (DOM real): renderiza inline, com os mesmos botões.
              export const Dialog = ({ title, children, footerButtons = [] }) =>
                createElement('div', { role: 'dialog', 'aria-label': title },
                  title, children,
                  footerButtons.map((b) => createElement('button', { key: b.content, onClick: b.onClick, disabled: b.disabled }, b.content)))
              export const ActionMenu = Object.assign(Pass, {
                Button: real.Button,
                Anchor: Pass,
                Overlay: () => null,
              })
            `,
          }))
        },
      },
      {
        name: 'fake-supabase',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/supabase\/config(\.js)?$/ }, (args) => ({
            path: args.path,
            namespace: 'fake',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
            contents: `
              export const supabase = {
                rpc: async (name, args) => {
                  globalThis.__rpcCalls.push({ name, args })
                  return globalThis.__rpc(name, args)
                },
              }
            `,
          }))
        },
      },
    ],
  })
  h = createRequire(import.meta.url)(outfile)
})
after(() => rm(directory, { recursive: true, force: true }))

function setup(handler) {
  globalThis.__rpcCalls = []
  globalThis.__rpc = handler
}
const names = () => globalThis.__rpcCalls.map((c) => c.name)

test('abrir a página não chama o banco e mostra o estado inicial', async () => {
  setup(async () => ({ data: null, error: null }))
  const page = h.mount()
  await page.tick()
  assert.deepEqual(names(), [])
  assert.match(page.text(), /Dados ainda não carregados/)
})

test('Atualizar = 1 RPC; busca, filtro, ordenação, abas, painel e CSV = 0 RPC', async () => {
  const accounts = [row(1), row(2, { status: 'disabled' }), row(3, { flags_count: 2 })]
  setup(async () => ({ data: snapshot(accounts), error: null }))
  const downloads = []
  globalThis.URL.createObjectURL = (blob) => (downloads.push(blob), 'blob:x')
  globalThis.URL.revokeObjectURL = () => {}
  globalThis.document.body = { appendChild() {} }
  globalThis.document.createElement = () => ({
    click() {},
    remove() {},
    set href(v) {},
    set download(v) {},
  })

  const page = h.mount()
  await page.press('Atualizar dados')
  await page.tick()
  assert.deepEqual(names(), ['admin_accounts_snapshot'])
  assert.equal(page.rows().length, 3)
  assert.match(page.text(), /Última atualização/)

  await page.type('Buscar por @usuário, e-mail ou UID', 'user2')
  assert.equal(page.rows().length, 1)
  await page.type('Buscar por @usuário, e-mail ou UID', '')
  assert.equal(page.rows().length, 3)

  await page.press('Ativas') // cartão de resumo como filtro local
  assert.equal(page.rows().length, 2)
  await page.press('Ativas')
  assert.equal(page.rows().length, 3)

  await page.press('Comunidades') // ordenação local
  await page.press('Moderação / risco') // aba local
  assert.equal(page.rows().length, 1)
  await page.press('Todas as contas')

  await page.clickRow(0) // abrir painel: Visão geral não lê nada
  assert.match(page.text(), /Detalhes da conta|Fechar painel/)
  await page.press('Exportar CSV')
  assert.equal(downloads.length, 1)

  assert.deepEqual(names(), ['admin_accounts_snapshot'])
})

test('Atualizar fica bloqueado durante a chamada e não dispara duas leituras', async () => {
  let release
  const gate = new Promise((resolve) => (release = resolve))
  setup(async () => {
    await gate
    return { data: snapshot([row(1)]), error: null }
  })
  const page = h.mount()
  await page.press('Atualizar dados')
  assert.equal(page.isDisabled('Atualizando...'), true)
  await page.press('Atualizando...')
  assert.deepEqual(names(), ['admin_accounts_snapshot'])
  release()
  await page.tick()
  assert.equal(page.rows().length, 1)
  assert.deepEqual(names(), ['admin_accounts_snapshot'])
})

test('falha no refresh mantém a tabela anterior e oferece nova tentativa', async () => {
  let attempt = 0
  setup(async () => {
    attempt++
    if (attempt === 1) return { data: snapshot([row(1), row(2)]), error: null }
    return { data: null, error: { message: 'network' } }
  })
  const page = h.mount()
  await page.press('Atualizar dados')
  await page.tick()
  assert.equal(page.rows().length, 2)
  await page.press('Atualizar')
  await page.tick()
  assert.equal(page.rows().length, 2) // snapshot antigo preservado
  assert.match(page.text(), /Não foi possível atualizar os dados/)
  assert.match(page.text(), /última atualização bem-sucedida/)
  assert.deepEqual(names(), ['admin_accounts_snapshot', 'admin_accounts_snapshot'])
})

test('primeira carga que falha mostra erro com nova tentativa, sem lista vazia enganosa', async () => {
  setup(async () => ({ data: null, error: { message: 'network' } }))
  const page = h.mount()
  await page.press('Atualizar dados')
  await page.tick()
  assert.match(page.text(), /Não foi possível atualizar os dados/)
  assert.doesNotMatch(page.text(), /Nenhuma conta encontrada/)
  assert.equal(page.rows().length, 0)
})

const rowText = (page, i) => {
  const flat = (inst) => inst.children.map((c) => (typeof c === 'string' ? c : flat(c))).join('')
  return flat(page.rows()[i])
}

test('desativar pelo painel: 1 escrita, linha e métricas atualizadas localmente, sem novo snapshot', async () => {
  const accounts = [row(1), row(2)]
  setup(async (name) =>
    name === 'admin_accounts_snapshot'
      ? { data: snapshot(accounts), error: null }
      : {
          data: [
            {
              id: accounts[0].id,
              ok: true,
              account_status: 'disabled',
              disabled_reason: 'Spam recorrente',
            },
          ],
          error: null,
        }
  )
  const page = h.mount()
  await page.press('Atualizar dados')
  // ordenação padrão: criadas mais recentemente primeiro => user2 na linha 0, user1 na linha 1
  assert.match(rowText(page, 1), /user1/)
  await page.clickRow(1)
  await page.press('Desativar')
  assert.match(page.text(), /Desativar @user1\?/)
  assert.equal(page.isDisabled('Desativar conta'), true) // motivo obrigatório
  await page.typeReason('Spam recorrente')
  await page.press('Desativar conta')

  assert.deepEqual(names(), ['admin_accounts_snapshot', 'admin_set_accounts_status'])
  assert.deepEqual(globalThis.__rpcCalls[1].args, {
    p_user_ids: [accounts[0].id],
    p_disabled: true,
    p_reason: 'Spam recorrente',
  })
  assert.match(rowText(page, 1), /Desativada/)
  assert.match(page.text(), /alterações locais/)
  assert.doesNotMatch(page.text(), /Desativar @user1\?/) // diálogo fechou
})

test('ação em lote: 1 RPC para N contas e falha parcial é reportada sem apagar nada', async () => {
  const accounts = [row(1), row(2), row(3)]
  setup(async (name, args) =>
    name === 'admin_accounts_snapshot'
      ? { data: snapshot(accounts), error: null }
      : {
          data: args.p_user_ids.map((id, i) =>
            i === 0
              ? { id, ok: true, account_status: 'disabled', disabled_reason: 'Revisão' }
              : { id, ok: false, error: 'ACCOUNT_DELETING' }
          ),
          error: null,
        }
  )
  const page = h.mount()
  await page.press('Atualizar dados')
  await page.check('Selecionar @user1')
  await page.check('Selecionar @user2')
  assert.match(page.text(), /2 selecionadas/)
  await page.press('Desativar') // barra de ações em massa
  assert.match(page.text(), /Desativar 2 contas\?/)
  await page.typeReason('Revisão em lote')
  await page.press('Desativar conta')

  const writes = names().filter((n) => n === 'admin_set_accounts_status')
  assert.equal(writes.length, 1)
  assert.equal(globalThis.__rpcCalls.at(-1).args.p_user_ids.length, 2)
  assert.deepEqual(names().filter((n) => n === 'admin_accounts_snapshot').length, 1)
  assert.match(page.text(), /1 desativada\(s\), 1 com falha/)
  assert.equal(page.rows().length, 3)
})

test('administrador e conta em exclusão não entram na ação em lote', async () => {
  const accounts = [
    row(1, { role: 'superadmin' }),
    row(2, { status: 'deleting', deletion_status: 'pending' }),
  ]
  setup(async () => ({ data: snapshot(accounts), error: null }))
  const page = h.mount()
  await page.press('Atualizar dados')
  await page.check('Selecionar @user1')
  await page.check('Selecionar @user2')
  await page.press('Desativar')
  assert.deepEqual(names(), ['admin_accounts_snapshot']) // nada enviado
  assert.doesNotMatch(page.text(), /Desativar 2 contas/)
  assert.match(page.text(), /Nenhuma das contas pode ser alterada/)
})

test('logs administrativos só são lidos ao clicar em Carregar logs', async () => {
  setup(async (name) =>
    name === 'admin_accounts_snapshot'
      ? { data: snapshot([row(1)]), error: null }
      : {
          data: [
            {
              id: 'l1',
              action: 'account_disabled',
              reason: 'Spam',
              metadata: {},
              created_at: '2026-10-10T12:00:00Z',
              admin_username: 'root',
              target_username: 'user1',
            },
          ],
          error: null,
        }
  )
  const page = h.mount()
  await page.press('Atualizar dados')
  await page.press('Logs administrativos')
  assert.match(page.text(), /Nenhum log carregado/)
  assert.deepEqual(names(), ['admin_accounts_snapshot'])
  await page.press('Carregar logs')
  assert.deepEqual(names(), ['admin_accounts_snapshot', 'admin_list_audit_log'])
  assert.match(page.text(), /Conta desativada/)
})
