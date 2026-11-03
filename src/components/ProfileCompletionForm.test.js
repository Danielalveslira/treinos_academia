import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

// Retomada de cadastro (ProfileCompletionGate): a mesma regra 18+ do cadastro vale aqui, inclusive
// quando a data vem preenchida de uma tentativa anterior. Validadores e o formulário são reais.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
let directory
let Form

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
    export const Flash = ({ children, variant, ...props }) => <div data-flash={variant} {...props}>{children}</div>
    export const Stack = ({ children }) => <div>{children}</div>
  `,
  layout: `export const PublicLayout = ({ children }) => <main>{children}</main>`,
  auth: `export const useAuth = () => globalThis.__pc.auth`,
  users: `export const isUsernameAvailable = (...a) => globalThis.__pc.api.available(...a)`,
  completion: `export const completeUserProfile = (...a) => globalThis.__pc.api.complete(...a)`,
  city: `export const CitySelector = ({ value, error }) => <div data-city={String(value)}>{error}</div>`,
  usage: `export const UsageProfileField = ({ value, onChange }) => <input data-usage="true" value={value} onChange={(e) => onChange(e.target.value)} />`,
  logout: `export const LogoutButton = () => <button type="button">Sair</button>`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'profile-completion-tests-'))
  const outfile = join(directory, 'form.cjs')
  await build({
    entryPoints: [
      new URL('./ProfileCompletionForm.jsx', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    ],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'profile-completion-stubs',
        setup(context) {
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          for (const [filter, path] of [
            [/^@primer\/react$/, 'primer'],
            [/\/PublicLayout$/, 'layout'],
            [/\/hooks\/useAuth$/, 'auth'],
            [/\/services\/usersService$/, 'users'],
            [/\/services\/profileCompletion$/, 'completion'],
            [/\/CitySelector$/, 'city'],
            [/\/UsageProfileField$/, 'usage'],
            [/\/LogoutButton$/, 'logout'],
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
  Form = require(outfile).default
})

after(async () => {
  delete globalThis.__pc
  if (directory) await rm(directory, { recursive: true, force: true })
})

let calls
beforeEach(() => {
  calls = []
  globalThis.__pc = {
    auth: {
      user: { uid: 'u1' },
      profile: null,
      refreshProfile: async () => calls.push(['refresh']),
    },
    api: {
      available: async () => true,
      complete: async (...args) => calls.push(['complete', ...args]),
    },
  }
})

async function mount(profile) {
  globalThis.__pc.auth.profile = profile
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Form))
  })
  const root = renderer.root
  const submit = () =>
    act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }))
  const username = (value) =>
    act(async () =>
      root
        .findAllByType('input')
        .find((i) => i.props.autoComplete === 'username')
        .props.onChange({ target: { value } })
    )
  const birth = (value) =>
    act(async () =>
      root
        .findAllByType('input')
        .find((i) => i.props.type === 'date')
        .props.onChange({ target: { value } })
    )
  const errors = () =>
    root.findAllByProps({ 'data-validation': 'true' }).map((n) => n.children.join(''))
  return { renderer, submit, username, birth, errors }
}

const resumedProfile = (dataNascimento) => ({
  dataNascimento,
  sexo: 'nao_informar',
  residenceMunicipalityCode: 2412500,
  usageProfile: 'professional',
})

test('retomada com data de menor (gravada antes da regra 18+) é bloqueada no campo', async () => {
  const minor = new Date(Date.now() - 16 * 365.25 * 86_400_000).toISOString().slice(0, 10)
  const view = await mount(resumedProfile(minor))
  await view.username('maria_fit')
  await view.submit()
  assert.ok(view.errors().includes('É necessário ter pelo menos 18 anos para se cadastrar.'))
  assert.equal(calls.length, 0, 'nada é enviado ao servidor')
  view.renderer.unmount()
})

test('adulto com dados válidos conclui o perfil normalmente', async () => {
  const view = await mount(resumedProfile('1990-05-10'))
  await view.username('maria_fit')
  await view.submit()
  const complete = calls.find((c) => c[0] === 'complete')
  assert.ok(complete, 'perfil enviado')
  assert.equal(complete[2].birthDate, '1990-05-10')
  assert.ok(calls.some((c) => c[0] === 'refresh'))
  view.renderer.unmount()
})

test('recusa do servidor (MINIMUM_AGE/BIRTHDATE_LOCKED) aparece no campo de nascimento', async () => {
  for (const [code, message] of [
    ['MINIMUM_AGE', 'É necessário ter pelo menos 18 anos para se cadastrar.'],
    [
      'BIRTHDATE_LOCKED',
      'A data de nascimento já está registrada. Para corrigi-la, use o atendimento.',
    ],
  ]) {
    globalThis.__pc.api.complete = async () => {
      throw new Error(code)
    }
    const view = await mount(resumedProfile('1990-05-10'))
    await view.username('maria_fit')
    const original = console.error
    console.error = () => {}
    try {
      await view.submit()
    } finally {
      console.error = original
    }
    assert.ok(view.errors().includes(message), code)
    assert.equal(
      calls.some((c) => c[0] === 'refresh'),
      false,
      `${code}: perfil não é dado como concluído`
    )
    view.renderer.unmount()
  }
})
