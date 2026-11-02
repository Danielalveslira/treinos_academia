import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

// "Descanso padrão entre séries" no Perfil: salvamento automático, valores válidos (inclusive 0), falha ao
// salvar, offline e sincronização vinda de outro aparelho (perfil atualizado pelo canal Realtime).

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
let directory
let RestPreferenceSettings
let restPreferenceSummary
let restSaveErrorText

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rest-preference-tests-'))
  const outfile = join(directory, 'settings.cjs')
  await build({
    stdin: {
      contents: `export { RestPreferenceSettings } from './RestPreferenceSettings.jsx'; export { restPreferenceSummary, restSaveErrorText } from '../utils/restPreference.js'`,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'rest-preference-stubs',
        setup(context) {
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          for (const [filter, path] of [
            [/^@primer\/react$/, 'primer'],
            [/^@primer\/octicons-react$/, 'icons'],
            [/\/hooks\/useAuth$/, 'auth'],
            [/\/services\/usersService$/, 'users'],
          ])
            context.onResolve({ filter }, () => ({ path, namespace: 'stub' }))
          context.onLoad({ filter: /^primer$/, namespace: 'stub' }, () => ({
            loader: 'jsx',
            contents: `
              const passthrough = (Tag) => ({ children, as, sx, variant, block, ...props }) => <Tag {...props}>{children}</Tag>
              export const Flash = passthrough('div')
              export const Box = passthrough('div')
              export const Text = ({ as: Tag = 'span', children, sx, ...props }) => <Tag {...props}>{children}</Tag>
              export const TextInput = ({ block, sx, ...props }) => <input {...props} />
              export const FormControl = ({ children }) => <div>{children}</div>
              FormControl.Label = ({ children }) => <label>{children}</label>
              FormControl.Caption = ({ children }) => <small>{children}</small>
            `,
          }))
          context.onLoad({ filter: /^icons$/, namespace: 'stub' }, () => ({
            contents: `export const CheckIcon = () => null`,
          }))
          context.onLoad({ filter: /^auth$/, namespace: 'stub' }, () => ({
            contents: `export const useAuth = () => globalThis.__restAuth`,
          }))
          context.onLoad({ filter: /^users$/, namespace: 'stub' }, () => ({
            contents: `export const setDefaultRestSeconds = (...args) => globalThis.__restSave(...args)`,
          }))
        },
      },
    ],
  })
  ;({ RestPreferenceSettings, restPreferenceSummary, restSaveErrorText } = require(outfile))
})

after(async () => {
  delete globalThis.__restAuth
  delete globalThis.__restSave
  if (directory) await rm(directory, { recursive: true, force: true })
})

let saves
let patches
const setOnline = (onLine) =>
  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true })
beforeEach(() => {
  saves = []
  patches = []
  setOnline(true)
  globalThis.__restSave = async (seconds) => {
    saves.push(seconds)
    return seconds
  }
})

const textOf = (node) =>
  typeof node === 'string' ? node : (node.children || []).map((child) => textOf(child)).join('')

async function mount(profile, { offlineLocal = false } = {}) {
  const auth = {
    user: { uid: 'user-a' },
    profile,
    offlineLocal,
    patchProfile: (uid, patch) => {
      patches.push([uid, patch])
      auth.profile = { ...auth.profile, ...patch }
    },
  }
  globalThis.__restAuth = auth
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(RestPreferenceSettings))
  })
  const root = renderer.root
  const api = {
    html: () => textOf(renderer.toJSON()),
    radios: () => root.findAll((node) => node.type === 'input' && node.props.type === 'radio'),
    checked: () => api.radios().find((node) => node.props.checked)?.props.value,
    radio: (value) => api.radios().find((node) => String(node.props.value) === String(value)),
    number: () => root.findAll((node) => node.type === 'input' && node.props.type === 'number')[0],
    fieldset: () => root.findByType('fieldset'),
    async choose(value) {
      await act(async () => api.radio(value).props.onChange())
    },
    // Simula o perfil vindo de fora (patchProfile local ou Realtime de outro aparelho).
    async setProfile(next) {
      auth.profile = next
      await act(async () => renderer.update(React.createElement(RestPreferenceSettings)))
    },
    async rerender() {
      await act(async () => renderer.update(React.createElement(RestPreferenceSettings)))
    },
    unmount: () => act(() => renderer.unmount()),
  }
  return api
}

test('sem preferência salva: 90s selecionado (o resumo da seção indica "padrão")', async () => {
  const ui = await mount({ id: 'user-a', defaultRestSeconds: null })
  assert.equal(ui.checked(), 90)
  assert.match(ui.html(), /Vale para exercícios sem tempo próprio na ficha/)
  // Grupo de rádio nomeado para leitor de tela, mesmo com a legenda visualmente oculta.
  assert.match(ui.html(), /Descanso padrão entre séries/)
  assert.deepEqual(
    ui.radios().map((node) => String(node.props.value)),
    ['30', '60', '90', '120', 'custom']
  )
  assert.equal(saves.length, 0, 'abrir a tela não grava nada')
  assert.equal(restPreferenceSummary(null), '1min30s (padrão)')
  assert.equal(restPreferenceSummary(60), '1min')
  assert.equal(restPreferenceSummary(0), 'Sem descanso')
  ui.unmount()
})

test('escolher uma opção salva sozinho, atualiza o perfil e dá feedback discreto', async () => {
  const ui = await mount({ id: 'user-a', defaultRestSeconds: null })
  await ui.choose(60)
  assert.deepEqual(saves, [60])
  assert.deepEqual(patches, [['user-a', { defaultRestSeconds: 60 }]])
  await ui.rerender()
  assert.equal(ui.checked(), 60)
  assert.match(ui.html(), /Salvo: 1min\./)
  ui.unmount()
})

test('personalizado: salva ao sair do campo; 0 desativa; fora da faixa não envia', async () => {
  const ui = await mount({ id: 'user-a', defaultRestSeconds: 90 })
  await ui.choose('custom')
  assert.equal(saves.length, 0, 'abrir o personalizado ainda não grava')
  assert.equal(ui.number().props.value, '90')

  await act(async () => ui.number().props.onChange({ target: { value: '901' } }))
  await act(async () => ui.number().props.onBlur())
  assert.equal(saves.length, 0)
  assert.match(ui.html(), /Informe um número inteiro de 0 a 900/)

  await act(async () => ui.number().props.onChange({ target: { value: '1.5' } }))
  await act(async () => ui.number().props.onKeyDown({ key: 'Enter', preventDefault() {} }))
  assert.equal(saves.length, 0)

  await act(async () => ui.number().props.onChange({ target: { value: '0' } }))
  await act(async () => ui.number().props.onKeyDown({ key: 'Enter', preventDefault() {} }))
  assert.deepEqual(saves, [0], '0 é um valor válido, não "vazio"')
  await ui.rerender()
  assert.match(ui.html(), /Salvo: Sem descanso\./)
  // O blur logo depois do Enter não grava de novo nem apaga o feedback.
  await act(async () => ui.number().props.onBlur())
  assert.deepEqual(saves, [0])
  assert.match(ui.html(), /Salvo: Sem descanso\./)
  ui.unmount()
})

test('valor salvo fora das opções rápidas abre como personalizado', async () => {
  const ui = await mount({ id: 'user-a', defaultRestSeconds: 75 })
  assert.equal(ui.checked(), 'custom')
  assert.equal(ui.number().props.value, '75')
  ui.unmount()
})

test('falha ao salvar: informa o erro e volta para o valor salvo', async () => {
  globalThis.__restSave = async (seconds) => {
    saves.push(seconds)
    throw new Error('network')
  }
  const ui = await mount({ id: 'user-a', defaultRestSeconds: 60 })
  await ui.choose(120)
  assert.deepEqual(saves, [120])
  assert.equal(patches.length, 0, 'perfil não é alterado')
  assert.equal(ui.checked(), 60)
  assert.match(ui.html(), /Não foi possível salvar\. Tente novamente\./)
  setOnline(false)
  await ui.choose(30)
  assert.match(ui.html(), /Sem conexão\. A preferência não foi salva/)
  ui.unmount()
})

test('banco sem a migration (PGRST202): diz que o recurso não existe no servidor, sem pedir nova tentativa', async () => {
  const original = console.error
  const logged = []
  console.error = (...args) => logged.push(args)
  globalThis.__restSave = async () => {
    throw {
      code: 'PGRST202',
      message:
        'Could not find the function public.set_default_rest_seconds(p_seconds) in the schema cache',
    }
  }
  try {
    const ui = await mount({ id: 'user-a', defaultRestSeconds: null })
    await ui.choose(60)
    assert.match(ui.html(), /ainda não está disponível no servidor\. Nada foi salvo\./)
    assert.doesNotMatch(ui.html(), /Tente novamente/)
    assert.equal(ui.checked(), 90, 'a seleção não finge que salvou')
    assert.equal(patches.length, 0)
    assert.equal(logged[0][1].code, 'PGRST202', 'a causa real fica registrada')
    ui.unmount()
  } finally {
    console.error = original
  }
})

test('restSaveErrorText classifica a causa real', () => {
  assert.match(
    restSaveErrorText({
      code: '42703',
      message: 'column users.default_rest_seconds does not exist',
    }),
    /não está disponível no servidor/
  )
  assert.match(
    restSaveErrorText({ code: 'P0001', message: 'INVALID_REST_SECONDS' }),
    /use de 0 a 900/
  )
  assert.match(restSaveErrorText({ code: 'P0001', message: 'NOT_AUTHENTICATED' }), /sessão/)
  assert.match(restSaveErrorText({ code: 'P0001', message: 'FORBIDDEN' }), /sessão/)
  assert.match(restSaveErrorText(new TypeError('Failed to fetch')), /Tente novamente/)
  setOnline(false)
  assert.match(restSaveErrorText(new TypeError('Failed to fetch')), /Sem conexão/)
})

test('toques repetidos durante o salvamento fazem uma única gravação', async () => {
  let release
  globalThis.__restSave = (seconds) => {
    saves.push(seconds)
    return new Promise((resolve) => {
      release = () => resolve(seconds)
    })
  }
  const ui = await mount({ id: 'user-a', defaultRestSeconds: 60 })
  await ui.choose(120)
  assert.equal(ui.fieldset().props.disabled, true)
  await act(async () => ui.radio(30).props.onChange())
  assert.deepEqual(saves, [120])
  await act(async () => release())
  assert.equal(ui.fieldset().props.disabled, false)
  ui.unmount()
})

test('offline (sessão local): mostra o valor, mas não permite alterar', async () => {
  const ui = await mount({ id: 'user-a', defaultRestSeconds: 30 }, { offlineLocal: true })
  assert.equal(ui.checked(), 30)
  assert.equal(ui.fieldset().props.disabled, true)
  assert.match(ui.html(), /Conecte-se à internet/)
  ui.unmount()
})

test('preferência alterada em outro aparelho aparece sem recarregar', async () => {
  const ui = await mount({ id: 'user-a', defaultRestSeconds: 60 })
  await ui.setProfile({ id: 'user-a', defaultRestSeconds: 120 })
  assert.equal(ui.checked(), 120)
  ui.unmount()
})
