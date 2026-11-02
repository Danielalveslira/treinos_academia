import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

// Cidade fora do cadastro: "Cidade onde mora" em Meu Perfil (ResidenceCitySettings) e a retomada de
// cadastro interrompido (ProfileCompletionGate). O seletor é substituído por botões; o resto é real.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
let directory
let ResidenceCitySettings
let ProfileCompletionGate
let ProfileCompletionForm

const STUBS = {
  primer: `
    export const FormControl = ({ children }) => <div>{children}</div>
    FormControl.Label = ({ children }) => <label>{children}</label>
    FormControl.Caption = ({ children }) => <small>{children}</small>
    FormControl.Validation = ({ children }) => <span data-validation="true">{children}</span>
    export const TextInput = ({ leadingVisual, block, size, ...props }) => <input {...props} />
    export const Button = ({ children, loading, variant, size, block, ...props }) => <button {...props}>{children}</button>
    export const Select = ({ children, block, ...props }) => <select {...props}>{children}</select>
    Select.Option = ({ children, ...props }) => <option {...props}>{children}</option>
    export const Flash = ({ children, variant, ...props }) => <div data-flash={variant || 'default'} {...props}>{children}</div>
    export const Stack = ({ children }) => <div>{children}</div>
  `,
  auth: `export const useAuth = () => globalThis.__city.auth`,
  users: `
    export const setResidenceMunicipality = (...a) => globalThis.__city.api.save(...a)
    export const isUsernameAvailable = (...a) => globalThis.__city.api.available(...a)
  `,
  completion: `export const completeUserProfile = (...a) => globalThis.__city.api.complete(...a)`,
  layout: `export const PublicLayout = ({ children }) => <main>{children}</main>`,
  logout: `export const LogoutButton = () => <button>Sair</button>`,
  fallback: `export const PageFallback = () => <div>carregando</div>`,
  city: `
    export const CitySelector = ({ value, onChange, error, disabled }) => (
      <div data-city={String(value)} data-disabled={String(Boolean(disabled))}>
        <button type="button" data-pick="3550308" onClick={() => onChange(3550308)}>pick</button>
        <button type="button" data-pick="1234567" onClick={() => onChange(1234567)}>pick-bad</button>
        <button type="button" data-clear="true" onClick={() => onChange(null)}>clear</button>
        {error && <span data-validation="true">{error}</span>}
      </div>
    )
  `,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'residence-city-tests-'))
  const outfile = join(directory, 'city.cjs')
  await build({
    stdin: {
      contents: `export { ResidenceCitySettings } from './ResidenceCitySettings.jsx'; export { ProfileCompletionGate } from './ProfileCompletionGate.jsx'; export { default as ProfileCompletionForm } from './ProfileCompletionForm.jsx'`,
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
        name: 'residence-stubs',
        setup(context) {
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          for (const [filter, path] of [
            [/^@primer\/react$/, 'primer'],
            [/\/hooks\/useAuth$/, 'auth'],
            [/\/services\/usersService$/, 'users'],
            [/\/services\/profileCompletion$/, 'completion'],
            [/\/PublicLayout$/, 'layout'],
            [/\/LogoutButton$/, 'logout'],
            [/\/PageFallback$/, 'fallback'],
            [/\/CitySelector$/, 'city'],
          ])
            context.onResolve({ filter }, () => ({ path, namespace: 'stub' }))
          context.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
            loader: 'jsx',
            contents: STUBS[path],
          }))
        },
      },
    ],
  })
  ;({ ResidenceCitySettings, ProfileCompletionGate, ProfileCompletionForm } = require(outfile))
})

after(async () => {
  delete globalThis.__city
  if (directory) await rm(directory, { recursive: true, force: true })
})

let calls
beforeEach(() => {
  calls = []
  globalThis.__city = {
    auth: {
      user: { uid: 'u1' },
      profile: { id: 'u1', username: 'maria', residenceMunicipalityCode: 2412500 },
      offlineLocal: false,
      patchProfile: (...args) => calls.push(['patch', ...args]),
      refreshProfile: async (...args) => calls.push(['refreshProfile', ...args]),
    },
    api: {
      save: async (code) => {
        calls.push(['save', code])
        return code
      },
      available: async () => true,
      complete: async (...args) => calls.push(['complete', ...args]),
    },
  }
})

function mount(Component, props = {}) {
  let renderer
  act(() => {
    renderer = TestRenderer.create(React.createElement(Component, props))
  })
  const root = renderer.root
  const text = () => JSON.stringify(renderer.toJSON())
  const button = (label) =>
    root.findAllByType('button').find((b) => b.children.join('') === label)
  const pick = async (code) => {
    await act(async () => root.findByProps({ 'data-pick': String(code) }).props.onClick())
  }
  const click = async (label) => {
    await act(async () => button(label).props.onClick())
  }
  return { renderer, root, text, button, pick, click }
}

test('Perfil: alterar e salvar a cidade atualiza o perfil só após confirmação do servidor', async () => {
  const view = mount(ResidenceCitySettings)
  assert.equal(view.root.findByProps({ 'data-city': '2412500' }).props['data-city'], '2412500')
  assert.equal(view.button('Salvar cidade').props.disabled, true)
  assert.match(view.text(), /Não aparece no seu perfil público/)
  await view.pick(3550308)
  assert.match(view.text(), /Alteração não salva/)
  await view.click('Salvar cidade')
  assert.deepEqual(calls, [
    ['save', 3550308],
    ['patch', 'u1', { residenceMunicipalityCode: 3550308 }],
  ])
  assert.match(view.text(), /Cidade salva/)
})

test('Perfil: falha ao salvar mantém a cidade anterior e mostra o erro', async () => {
  globalThis.__city.api.save = async () => {
    throw new TypeError('Failed to fetch')
  }
  const view = mount(ResidenceCitySettings)
  await view.pick(3550308)
  const original = console.error
  console.error = () => {}
  try {
    await view.click('Salvar cidade')
  } finally {
    console.error = original
  }
  assert.ok(!calls.some((c) => c[0] === 'patch'), 'perfil em memória não mudou')
  assert.match(view.text(), /cidade anterior foi mantida/)
  assert.equal(view.root.findByProps({ 'data-city': '3550308' }).props['data-city'], '3550308')
  await view.click('Cancelar')
  assert.equal(view.root.findByProps({ 'data-city': '2412500' }).props['data-city'], '2412500')
})

test('Perfil: código recusado pelo servidor e campo limpo não são aceitos', async () => {
  globalThis.__city.api.save = async () => {
    throw new Error('INVALID_MUNICIPALITY')
  }
  const view = mount(ResidenceCitySettings)
  await view.pick(1234567)
  const original = console.error
  console.error = () => {}
  try {
    await view.click('Salvar cidade')
  } finally {
    console.error = original
  }
  assert.match(view.text(), /Cidade não reconhecida/)
  await act(async () => view.root.findByProps({ 'data-clear': 'true' }).props.onClick())
  await view.click('Salvar cidade')
  assert.match(view.text(), /Selecione a cidade onde você mora/)
})

test('Perfil: conta antiga sem cidade recebe um convite, sem bloqueio', () => {
  globalThis.__city.auth.profile = { id: 'u1', username: 'antigo', residenceMunicipalityCode: null }
  const view = mount(ResidenceCitySettings)
  assert.match(view.text(), /ainda não informou sua cidade/)
  assert.equal(view.root.findByProps({ 'data-city': 'null' }).props['data-city'], 'null')
})

test('Perfil: offline não permite alterar', () => {
  globalThis.__city.auth.offlineLocal = true
  const view = mount(ResidenceCitySettings)
  assert.match(view.text(), /Conecte-se à internet/)
  assert.equal(view.root.findByProps({ 'data-city': '2412500' }).props['data-disabled'], 'true')
})

test('gate: conta antiga completa (com @, sem cidade) não é bloqueada', () => {
  globalThis.__city.auth.profile = { id: 'u1', username: 'antigo', residenceMunicipalityCode: null }
  const view = mount(ProfileCompletionGate, { children: React.createElement('p', null, 'APP') })
  assert.match(view.text(), /APP/)
  assert.doesNotMatch(view.text(), /Complete seu cadastro/)
})

test('gate: cadastro interrompido exige cidade e reaproveita o que já foi salvo', async () => {
  globalThis.__city.auth.profile = {
    id: 'u1',
    username: null,
    dataNascimento: '1990-02-03',
    sexo: 'feminino',
    usageProfile: 'professional',
    residenceMunicipalityCode: null,
  }
  const view = mount(ProfileCompletionForm)
  assert.match(view.text(), /Complete seu cadastro/)
  assert.equal(view.root.findByType('select').props.value, 'feminino', 'sexo já salvo vem escolhido')
  const date = view.root.findAllByType('input').find((i) => i.props.type === 'date')
  assert.equal(date.props.value, '1990-02-03', 'nascimento já salvo vem preenchido')
  const username = view.root.findAllByType('input').find((i) => i.props.autoComplete === 'username')
  await act(async () => username.props.onChange({ target: { value: 'maria_fit' } }))
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.ok(
    view.root.findAllByProps({ 'data-validation': 'true' }).some((n) => /Selecione a cidade/.test(n.children.join('')))
  )
  assert.equal(calls.length, 0)
  await view.pick(3550308)
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  const complete = calls.find((c) => c[0] === 'complete')
  assert.deepEqual(complete[2], {
    username: 'maria_fit',
    sexo: 'feminino',
    birthDate: '1990-02-03',
    usageProfile: 'professional',
    residenceMunicipalityCode: 3550308,
  })
  assert.ok(calls.some((c) => c[0] === 'refreshProfile'))
})

test('gate: cidade já salva numa tentativa anterior vem selecionada; erro do servidor vai ao campo', async () => {
  globalThis.__city.auth.profile = {
    id: 'u1',
    username: null,
    usageProfile: 'common',
    residenceMunicipalityCode: 2412500,
  }
  globalThis.__city.api.complete = async () => {
    throw new Error('INVALID_MUNICIPALITY')
  }
  const view = mount(ProfileCompletionForm)
  assert.equal(view.root.findByType('select').props.value, '', 'sem sexo salvo: "Selecione uma opção"')
  assert.equal(view.root.findByProps({ 'data-city': '2412500' }).props['data-city'], '2412500')
  const original = console.error
  console.error = () => {}
  try {
    const inputs = view.root.findAllByType('input')
    await act(async () => inputs.find((i) => i.props.autoComplete === 'username').props.onChange({ target: { value: 'maria_fit' } }))
    await act(async () => inputs.find((i) => i.props.type === 'date').props.onChange({ target: { value: '1990-02-03' } }))
    await act(async () => view.root.findByType('select').props.onChange({ target: { value: 'nao_informar' } }))
    const radio = view.root.findAllByType('input').find((i) => i.props.value === 'common')
    await act(async () => radio.props.onChange())
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  } finally {
    console.error = original
  }
  assert.match(view.text(), /Cidade não reconhecida/)
})

test('gate: cadastro interrompido sem sexo exige a escolha antes de concluir', async () => {
  globalThis.__city.auth.profile = { id: 'u1', username: null, residenceMunicipalityCode: 2412500 }
  const view = mount(ProfileCompletionForm)
  const inputs = view.root.findAllByType('input')
  await act(async () => inputs.find((i) => i.props.autoComplete === 'username').props.onChange({ target: { value: 'maria_fit' } }))
  await act(async () => inputs.find((i) => i.props.type === 'date').props.onChange({ target: { value: '1990-02-03' } }))
  const radio = view.root.findAllByType('input').find((i) => i.props.value === 'common')
  await act(async () => radio.props.onChange())
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.match(view.text(), /Selecione uma opção para Sexo/)
  assert.ok(!calls.some((c) => c[0] === 'complete'))
})
