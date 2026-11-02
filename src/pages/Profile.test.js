import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let mount
let act

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'profile-editor-test-'))
  const outfile = join(directory, 'profile.cjs')
  const mocks = new Map([
    ['../hooks/useAuth', 'export const useAuth = () => globalThis.__profileAuth'],
    [
      '../services/publicProfilesService',
      'export const refreshPublicStatistics = () => globalThis.__profileApi.refresh()',
    ],
    [
      '../services/profileAvatarService',
      'export const uploadProfileAvatar = (...args) => globalThis.__profileApi.upload(...args); export const removeProfileAvatar = () => globalThis.__profileApi.remove()',
    ],
    [
      '../services/usageProfileService',
      'export const setUsageProfile = (...args) => globalThis.__profileApi.usage(...args)',
    ],
    ['../services/usersService', 'export const BIO_MAX_LENGTH = 300'],
    [
      '../components/ProfileAvatar',
      "export const ProfileAvatar = () => <div data-avatar='true' />",
    ],
    ['../components/LegalLinks', "export const LegalLinks = () => <div data-legal='true' />"],
    [
      '../components/UsageProfileField',
      "export const UsageProfileField = () => <div data-usage='true' />",
    ],
    [
      '../features/notifications/components/PushNotificationSettings',
      "export const PushNotificationSettings = () => <div data-push='true' />",
    ],
    [
      '../features/greetings/GreetingVoiceSettings',
      "export const GreetingVoiceSettings = () => <div data-greeting='true' />",
    ],
    [
      '../components/RestPreferenceSettings',
      "export const RestPreferenceSettings = () => <div data-rest='true' />",
    ],
    ['../features/greetings/config', 'export const GREETING_V2_ENABLED = true'],
    [
      'react-router-dom',
      "import { createElement } from 'react'; export const Link = ({ to, children }) => createElement('a', { href: to }, children)",
    ],
    [
      '@primer/react',
      `
      import { createElement } from 'react'
      const Control = ({ children }) => createElement('div', null, children)
      Control.Label = ({ children }) => createElement('label', null, children)
      Control.Caption = ({ children }) => createElement('small', null, children)
      Control.Validation = ({ children }) => createElement('span', { role: 'alert' }, children)
      export const FormControl = Control
      export const Button = ({ children, loading, variant, sx, ...props }) => createElement('button', props, children)
      export const TextInput = ({ leadingVisual, block, sx, ...props }) => createElement('input', props)
      export const Textarea = ({ block, sx, ...props }) => createElement('textarea', props)
      export const Flash = ({ children, variant, ...props }) => createElement('div', props, children)
    `,
    ],
  ])
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import Profile from './Profile.jsx'
        export { act }
        export const mount = () => TestRenderer.create(createElement(Profile))
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'profile-stubs',
        setup(ctx) {
          ctx.onResolve(
            { filter: /^(react|react\/jsx-runtime|react-test-renderer)$/ },
            ({ path }) => ({ path: createRequire(import.meta.url).resolve(path), external: true })
          )
          ctx.onResolve({ filter: /.*/ }, ({ path }) =>
            mocks.has(path) ? { path, namespace: 'stub' } : undefined
          )
          ctx.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
            contents: mocks.get(path),
            loader: 'jsx',
          }))
        },
      },
    ],
  })
  ;({ mount, act } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  delete globalThis.__profileAuth
  delete globalThis.__profileApi
})

function setup(overrides = {}, saveImpl = null) {
  const calls = []
  const profile = {
    id: 'user-1',
    username: 'maria',
    bio: 'Treino',
    shareStatistics: false,
    usageProfile: 'common',
    avatarPath: 'avatar.webp',
    ...overrides,
  }
  globalThis.__profileApi = {
    refresh: async () => {
      calls.push('refresh')
    },
    upload: async (file) => {
      calls.push(['upload', file])
    },
    remove: async () => {
      calls.push('remove')
    },
    usage: async (value) => {
      calls.push(['usage', value])
    },
  }
  globalThis.__profileAuth = {
    user: { uid: 'user-1', email: 'maria@example.com' },
    profile,
    isSuperAdmin: false,
    saveProfile:
      saveImpl ||
      (async (patch) => {
        calls.push(['save', patch])
        Object.assign(profile, patch)
      }),
    refreshProfile: async () => {
      calls.push('refreshProfile')
    },
  }
  let renderer
  act(() => {
    renderer = mount()
  })
  const nodeText = (node) =>
    typeof node === 'string' ? node : node.children.map(nodeText).join('')
  const buttons = (label) =>
    renderer.root.findAllByType('button').filter((node) => nodeText(node) === label)
  const click = async (label) => {
    await act(async () => {
      buttons(label)[0].props.onClick()
    })
  }
  return { calls, profile, renderer, buttons, click }
}

test('perfil mantém dados pessoais, avatar, acesso público e nenhum saldo', () => {
  const { renderer, buttons } = setup()
  const text = JSON.stringify(renderer.toJSON())
  assert.match(text, /Meu perfil|Nome de usuário/)
  assert.match(text, /\/comunidades\/perfil\/user-1/)
  assert.doesNotMatch(text, /EvoCoins|EvoCash|Reputação|Carteira/)
  assert.equal(buttons('Salvar alterações')[0].props.disabled, true)
  assert.equal(renderer.root.findAllByProps({ 'data-avatar': 'true' }).length, 1)
  assert.equal(renderer.root.findAllByProps({ 'data-push': 'true' }).length, 0)
  assert.equal(renderer.root.findAllByProps({ 'data-legal': 'true' }).length, 1)
})

test('privacidade salva apenas sua preferência e mantém rascunho do nome', async () => {
  const view = setup()
  await view.click('Privacidade e estatísticasDesativado›')
  const checkbox = view.renderer.root
    .findAllByType('input')
    .find((node) => node.props.type === 'file')
  assert.equal(checkbox.props.type, 'file')
  const privacy = view.renderer.root
    .findAllByType('input')
    .find((node) => node.props.type === 'checkbox')
  assert.equal(privacy.props.checked, false)
  await act(async () => {
    view.renderer.root
      .findAllByType('input')
      .find((node) => node.props.autoComplete === 'username')
      .props.onChange({ target: { value: 'nova_maria' } })
  })
  await act(async () => {
    privacy.props.onChange({ target: { checked: true } })
  })
  await view.click('Salvar preferência')
  assert.deepEqual(view.calls[0], ['save', { shareStatistics: true }])
  assert.equal(
    view.renderer.root.findAllByType('input').find((node) => node.props.autoComplete === 'username')
      .props.value,
    'nova_maria'
  )
  await act(async () => {
    view.renderer.root.findByType('form').props.onSubmit({ preventDefault() {} })
  })
  assert.deepEqual(view.calls[1], ['save', { username: 'nova_maria' }])
  await view.click('Atualizar estatísticas')
  assert.equal(view.calls[2], 'refresh')
})

test('foto e configurações permanecem independentes', async () => {
  const view = setup()
  const file = { name: 'foto.png' }
  await act(async () => {
    view.renderer.root
      .findAllByType('input')
      .find((node) => node.props.type === 'file')
      .props.onChange({ target: { files: [file] } })
  })
  await view.click('Salvar foto')
  assert.deepEqual(view.calls.slice(0, 2), [['upload', file], 'refreshProfile'])
  await view.click('Perfil de usoUsuário comum›')
  assert.equal(view.renderer.root.findAllByProps({ 'data-usage': 'true' }).length, 1)
  await view.click('NotificaçõesConfigurar›')
  assert.equal(view.renderer.root.findAllByProps({ 'data-push': 'true' }).length, 1)
  await view.click('Mensagens da HomeAutomático›')
  assert.equal(view.renderer.root.findAllByProps({ 'data-greeting': 'true' }).length, 1)
})

test('nome inválido bloqueia salvamento; envio duplo faz uma chamada', async () => {
  const view = setup()
  const input = () =>
    view.renderer.root.findAllByType('input').find((node) => node.props.autoComplete === 'username')
  await act(async () => {
    input().props.onChange({ target: { value: 'ab' } })
  })
  await act(async () => {
    view.renderer.root.findByType('form').props.onSubmit({ preventDefault() {} })
  })
  assert.equal(view.calls.length, 0)
  assert.match(JSON.stringify(view.renderer.toJSON()), /3|inválido|usuário/)

  await act(async () => {
    input().props.onChange({ target: { value: 'nova_maria' } })
  })
  act(() => {
    view.renderer.root.findByType('form').props.onSubmit({ preventDefault() {} })
    view.renderer.root.findByType('form').props.onSubmit({ preventDefault() {} })
  })
  assert.equal(view.calls.length, 1)
  await act(async () => {})
})

test('remoção de foto exige confirmação e preserva dados pessoais', async () => {
  const view = setup()
  globalThis.window = { confirm: () => false }
  await view.click('Remover foto')
  assert.equal(view.calls.length, 0)
  globalThis.window.confirm = () => true
  await view.click('Remover foto')
  assert.deepEqual(view.calls, ['remove', 'refreshProfile'])
  delete globalThis.window
})

test('falha ao salvar mantém a edição e informa o erro', async () => {
  const view = setup({}, async () => {
    throw new Error('offline')
  })
  await act(async () => {
    view.renderer.root
      .findAllByType('input')
      .find((node) => node.props.autoComplete === 'username')
      .props.onChange({ target: { value: 'nova_maria' } })
  })
  await act(async () => {
    view.renderer.root.findByType('form').props.onSubmit({ preventDefault() {} })
  })
  assert.equal(
    view.renderer.root.findAllByType('input').find((node) => node.props.autoComplete === 'username')
      .props.value,
    'nova_maria'
  )
  assert.match(JSON.stringify(view.renderer.toJSON()), /Não foi possível salvar/)
})

test('perfil de outra conta não aparece durante troca de usuário', () => {
  const view = setup({ id: 'other', username: 'conta_antiga', bio: 'Privado' })
  const html = JSON.stringify(view.renderer.toJSON())
  assert.doesNotMatch(html, /conta_antiga|Privado/)
  assert.match(html, /Não foi possível carregar seu perfil/)
  assert.equal(view.buttons('Salvar alterações')[0].props.disabled, true)
})
