import { after, afterEach, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

// Cadastro em 3 etapas (mesma rota): navegação, validação por etapa, dados preservados ao voltar,
// @ indisponível, cidade, consentimentos, envio duplo, erros do servidor e confirmação por código.
// Serviços, Auth e o seletor de cidade são substituídos; validadores e o fluxo da página são reais.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
let directory
let Register

const STUBS = {
  primer: `
    import { forwardRef } from 'react'
    export const FormControl = ({ children, disabled }) => <div data-disabled={disabled ? 'true' : undefined}>{children}</div>
    FormControl.Label = ({ children }) => <label>{children}</label>
    FormControl.Caption = ({ children }) => <small>{children}</small>
    FormControl.Validation = ({ children }) => <span data-validation="true">{children}</span>
    export const TextInput = forwardRef(({ leadingVisual, trailingAction, block, size, ...props }, ref) => (
      <span><input ref={ref} {...props} />{trailingAction}</span>
    ))
    TextInput.Action = ({ icon, tooltipDirection, ...props }) => <button type="button" {...props} />
    export const Button = ({ children, loading, variant, size, block, as, ...props }) => <button {...props}>{children}</button>
    export const Select = ({ children, block, ...props }) => <select {...props}>{children}</select>
    Select.Option = ({ children, ...props }) => <option {...props}>{children}</option>
    export const Link = ({ children, as, to, ...props }) => <a href={to} {...props}>{children}</a>
    export const Flash = ({ children, variant, ...props }) => <div data-flash={variant || 'default'} {...props}>{children}</div>
    export const Stack = ({ children }) => <div>{children}</div>
  `,
  icons: `const I = () => null; export const CheckCircleFillIcon = I, CircleIcon = I, EyeClosedIcon = I, EyeIcon = I`,
  router: `
    export const Link = ({ children, to }) => <a href={to}>{children}</a>
    export const Navigate = ({ to }) => <div data-navigate={to} />
    export const useNavigate = () => (...args) => globalThis.__reg.navigate(...args)
  `,
  analytics: `export const track = () => {}`,
  layout: `
    export const AuthLayout = ({ title, description, titleRef, children, footer }) => (
      <main>
        <h1 ref={titleRef} tabIndex={-1}>{title}</h1>
        <p>{description}</p>
        {children}
        <footer>{footer}</footer>
      </main>
    )
  `,
  auth: `
    export const registerUser = (...a) => globalThis.__reg.api.registerUser(...a)
    export const confirmSignupAndSyncPassword = (...a) => globalThis.__reg.api.confirm(...a)
    export const sendVerificationEmail = (...a) => globalThis.__reg.api.resend(...a)
  `,
  users: `export const isUsernameAvailable = (...a) => globalThis.__reg.api.available(...a)`,
  completion: `export const completeUserProfile = (...a) => globalThis.__reg.api.complete(...a)`,
  catalog: `export const loadMunicipalityCatalog = () => Promise.resolve(null)`,
  legalService: `
    export const getActiveLegalBundle = () => globalThis.__reg.api.bundle()
    export const acceptLegalDocuments = (...a) => globalThis.__reg.api.accept(...a)
    export const isLegalPolicyChangedError = () => false
  `,
  legal: `export const canSubmitLegalRegistration = ({ bundle, loading, confirmed }) =>
    !loading && bundle?.manifest?.published === true && confirmed.accepted === true`,
  useAuth: `export const useAuth = () => globalThis.__reg.auth`,
  online: `export const useOnlineStatus = () => globalThis.__reg.online`,
  city: `
    export const CitySelector = ({ value, onChange, error }) => (
      <div data-city={String(value)}>
        <button type="button" data-pick-city="2412500" onClick={() => onChange(2412500)}>pick</button>
        <button type="button" data-clear-city="true" onClick={() => onChange(null)}>clear</button>
        {error && <span data-validation="true" aria-invalid="true">{error}</span>}
      </div>
    )
  `,
  consent: `
    export const LegalConsent = ({ value, onChange }) => (
      <fieldset>
        <input type="checkbox" data-consent="accepted" checked={value.accepted} onChange={(e) => onChange({ ...value, accepted: e.target.checked })} />
        <input type="checkbox" data-consent="health" checked={value.healthDataConsent} onChange={(e) => onChange({ ...value, healthDataConsent: e.target.checked })} />
      </fieldset>
    )
  `,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'register-tests-'))
  const outfile = join(directory, 'register.cjs')
  await build({
    stdin: {
      contents: `export { default as Register } from './Register.jsx'`,
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
        name: 'register-stubs',
        setup(context) {
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          for (const [filter, path] of [
            [/^@primer\/react$/, 'primer'],
            [/^@primer\/octicons-react$/, 'icons'],
            [/^react-router-dom$/, 'router'],
            [/^@vercel\/analytics$/, 'analytics'],
            [/\/components\/PublicLayout$/, 'layout'],
            [/\/services\/authService$/, 'auth'],
            [/\/services\/usersService$/, 'users'],
            [/\/services\/profileCompletion$/, 'completion'],
            [/\/services\/municipalityCatalog$/, 'catalog'],
            [/\/services\/legalService$/, 'legalService'],
            [/\/utils\/legal$/, 'legal'],
            [/\/hooks\/useAuth$/, 'useAuth'],
            [/\/hooks\/useOnlineStatus$/, 'online'],
            [/\/components\/CitySelector$/, 'city'],
            [/\/components\/LegalConsent$/, 'consent'],
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
  ;({ Register } = require(outfile))
})

after(async () => {
  delete globalThis.__reg
  if (directory) await rm(directory, { recursive: true, force: true })
})

let calls
const mounted = []
// Desmonta tudo ao fim de cada teste (o contador de reenvio do código usa setInterval).
afterEach(async () => {
  await act(async () => {
    while (mounted.length) mounted.pop().unmount()
  })
})
beforeEach(() => {
  calls = []
  const log = (name, result) => (...args) => {
    calls.push([name, ...args])
    return typeof result === 'function' ? result(...args) : Promise.resolve(result)
  }
  globalThis.__reg = {
    navigate: (...args) => calls.push(['navigate', ...args]),
    auth: { user: null, loading: false, refreshProfile: log('refreshProfile') },
    online: true,
    api: {
      registerUser: log('registerUser', { user: { uid: 'u1' }, hasSession: true }),
      confirm: log('confirm'),
      resend: log('resend'),
      available: log('available', true),
      complete: log('complete'),
      accept: log('accept'),
      bundle: () => Promise.resolve({ manifest: { published: true, minimumAge: 16, version: '1' } }),
    },
  }
})

const count = (name) => calls.filter((c) => c[0] === name).length

async function mount() {
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Register))
  })
  mounted.push(renderer)
  const root = () => renderer.root
  const text = () => JSON.stringify(renderer.toJSON())
  const title = () => root().findByType('h1').children.join('')
  const inputs = () => root().findAllByType('input')
  const inputByAutocomplete = (value) => inputs().find((i) => i.props.autoComplete === value)
  const fields = {
    username: () => inputByAutocomplete('username'),
    email: () => inputByAutocomplete('email'),
    password: () => inputByAutocomplete('new-password'),
    birthDate: () => inputByAutocomplete('bday'),
  }
  const change = async (name, value) => {
    await act(async () => fields[name]().props.onChange({ target: { value } }))
  }
  const blur = async (name) => {
    await act(async () => fields[name]().props.onBlur?.())
  }
  const button = (label) =>
    root().findAllByType('button').find((b) => b.children.join('') === label)
  const submit = async () => {
    await act(async () => root().findByType('form').props.onSubmit({ preventDefault() {} }))
  }
  const click = async (label) => {
    const target = button(label)
    assert.ok(target, `botão "${label}" não encontrado`)
    if (target.props.type === 'submit') return submit()
    await act(async () => target.props.onClick())
  }
  const errors = () => root().findAllByProps({ 'data-validation': 'true' }).map((n) => n.children.join(''))
  const progress = () =>
    root().findAllByProps({ 'aria-current': 'step' })[0].findAllByType('span')[1].children[0]
  return { renderer, text, title, change, blur, button, submit, click, errors, progress, fields, root }
}

async function fillStep1(view, { username = 'maria_fit', email = 'maria@exemplo.com', password = 'senha123' } = {}) {
  await view.change('username', username)
  await view.change('email', email)
  await view.change('password', password)
}

const sexoSelect = (view) => view.root().findByType('select')
async function chooseSexo(view, value) {
  await act(async () => sexoSelect(view).props.onChange({ target: { value } }))
}

async function fillStep2(view, sexo = 'nao_informar') {
  await view.change('birthDate', '1995-05-10')
  await act(async () => view.root().findByProps({ 'data-pick-city': '2412500' }).props.onClick())
  await chooseSexo(view, sexo)
}

// Só o aceite contratual é obrigatório; o consentimento de saúde é opcional.
async function acceptConsents(view, keys = ['accepted']) {
  for (const key of keys) {
    const box = view.root().findByProps({ 'data-consent': key })
    await act(async () => box.props.onChange({ target: { checked: true } }))
  }
}

async function chooseUsage(view, value = 'professional') {
  const radio = view.root().findAllByType('input').find((i) => i.props.type === 'radio' && i.props.value === value)
  await act(async () => radio.props.onChange())
}

test('etapa 1: campos obrigatórios, e-mail e senha inválidos não avançam', async () => {
  const view = await mount()
  assert.equal(view.title(), 'Crie sua conta')
  assert.equal(view.progress(), 'Sua conta')
  assert.equal(
    view.root().findAllByProps({ className: 'sr-only' })[0].children.join(''),
    'Etapa 1 de 3: Sua conta'
  )
  assert.equal(view.errors().length, 0, 'nenhum erro antes de interagir')
  await view.click('Continuar')
  assert.equal(view.title(), 'Crie sua conta')
  assert.equal(view.errors().length, 3)

  await fillStep1(view, { email: 'maria@exemplo', password: 'curta' })
  await view.click('Continuar')
  assert.equal(view.title(), 'Crie sua conta')
  assert.ok(view.errors().some((e) => /E-mail inválido/.test(e)))
  assert.ok(view.errors().some((e) => /pelo menos 8/.test(e)))
  assert.equal(count('available'), 0, 'formato inválido não consulta o servidor')
  assert.equal(count('registerUser'), 0)
})

test('etapa 1: mostrar/ocultar senha e requisitos compactos', async () => {
  const view = await mount()
  assert.equal(view.fields.password().props.type, 'password')
  await act(async () => view.root().findByProps({ 'aria-label': 'Mostrar senha' }).props.onClick())
  assert.equal(view.fields.password().props.type, 'text')
  assert.ok(view.root().findByProps({ 'aria-label': 'Ocultar senha' }))
  assert.match(view.text(), /8\+ caracteres/)
  assert.match(view.text(), /letras e números/)
})

test('@ indisponível bloqueia a etapa 1; o resultado é reaproveitado sem nova consulta', async () => {
  globalThis.__reg.api.available = (...args) => {
    calls.push(['available', ...args])
    return Promise.resolve(false)
  }
  const view = await mount()
  await fillStep1(view)
  await view.blur('username')
  assert.ok(view.errors().includes('Esse nome de usuário já está em uso'))
  await view.click('Continuar')
  assert.equal(view.title(), 'Crie sua conta')
  assert.equal(count('available'), 1, 'mesmo @: sem requisição repetida')
})

test('3 etapas: avança, volta preservando tudo e cria a conta uma única vez', async () => {
  const view = await mount()
  await fillStep1(view)
  await view.click('Continuar')
  assert.equal(view.title(), 'Conte um pouco sobre você')
  assert.equal(view.progress(), 'Sobre você')
  assert.equal(count('available'), 1)

  await view.click('Continuar')
  assert.ok(view.errors().some((e) => /Data de nascimento é obrigatória/.test(e)))
  assert.ok(view.errors().some((e) => /Selecione a cidade/.test(e)), 'cidade não selecionada')
  assert.ok(view.errors().includes('Selecione uma opção para Sexo'), 'sexo não escolhido')
  assert.equal(sexoSelect(view).props.value, '', 'começa em "Selecione uma opção"')
  await fillStep2(view, 'feminino')
  await view.click('Continuar')
  assert.equal(view.title(), 'Tudo pronto para começar')

  await view.click('Voltar')
  assert.equal(view.fields.birthDate().props.value, '1995-05-10')
  assert.equal(view.root().findByProps({ 'data-city': '2412500' }).props['data-city'], '2412500')
  assert.equal(sexoSelect(view).props.value, 'feminino', 'sexo preservado ao voltar')
  await view.click('Voltar')
  assert.equal(view.fields.username().props.value, 'maria_fit')
  assert.equal(view.fields.password().props.value, 'senha123')
  await view.click('Continuar')
  await view.click('Continuar')
  assert.equal(count('available'), 1, 'voltar/avançar com o mesmo @ não repete a consulta')

  await view.click('Criar conta')
  assert.ok(view.errors().some((e) => /como você pretende utilizar/i.test(e)))
  assert.ok(view.errors().some((e) => /Aceite os Termos de Uso/.test(e)))
  assert.equal(count('registerUser'), 0)

  await chooseUsage(view)
  await acceptConsents(view)
  // Duplo envio: dois submits seguidos antes do primeiro terminar.
  await act(async () => {
    const form = view.root().findByType('form')
    form.props.onSubmit({ preventDefault() {} })
    form.props.onSubmit({ preventDefault() {} })
  })
  assert.equal(count('registerUser'), 1)
  assert.deepEqual(calls.find((c) => c[0] === 'registerUser').slice(1), ['maria@exemplo.com', 'senha123'])
  const complete = calls.find((c) => c[0] === 'complete')
  assert.deepEqual(complete[2], {
    username: 'maria_fit',
    sexo: 'feminino',
    birthDate: '1995-05-10',
    usageProfile: 'professional',
    residenceMunicipalityCode: 2412500,
  })
  assert.equal(count('accept'), 1)
  const accept = calls.find((c) => c[0] === 'accept')
  assert.equal(accept[1].accepted, true)
  assert.notEqual(accept[1].healthDataConsent, true, 'consentimento de saúde nunca é presumido')
  assert.equal(accept[3], 'signup')
  assert.deepEqual(calls.find((c) => c[0] === 'navigate').slice(1), ['/app', { replace: true }])
})

test('Enter nas etapas 1 e 2 só avança (nunca cria a conta antes da etapa 3)', async () => {
  const view = await mount()
  await fillStep1(view)
  await view.submit()
  assert.equal(view.title(), 'Conte um pouco sobre você')
  await fillStep2(view)
  await view.submit()
  assert.equal(view.title(), 'Tudo pronto para começar')
  assert.equal(count('registerUser'), 0)
})

test('idade mínima e data futura são recusadas na etapa 2', async () => {
  const view = await mount()
  await fillStep1(view)
  await view.click('Continuar')
  await view.change('birthDate', '2099-01-01')
  await view.blur('birthDate')
  assert.ok(view.errors().some((e) => /futuro/.test(e)))
  const young = new Date()
  young.setFullYear(young.getFullYear() - 10)
  await view.change('birthDate', young.toISOString().slice(0, 10))
  await view.click('Continuar')
  assert.ok(view.errors().some((e) => /pelo menos 16 anos/.test(e)))
  assert.equal(view.title(), 'Conte um pouco sobre você')
})

async function reachFinal(view) {
  await fillStep1(view)
  await view.click('Continuar')
  await fillStep2(view)
  await view.click('Continuar')
  await chooseUsage(view)
  await acceptConsents(view)
}

test('consentimento opcional de medidas corporais segue ao aceite apenas quando marcado', async () => {
  const view = await mount()
  await fillStep1(view)
  await view.click('Continuar')
  await fillStep2(view)
  await view.click('Continuar')
  await chooseUsage(view)
  await acceptConsents(view, ['accepted', 'health'])
  await view.click('Criar conta')
  const accept = calls.find((c) => c[0] === 'accept')
  assert.equal(accept[1].healthDataConsent, true)
  assert.equal(accept[3], 'signup')
})

test('e-mail já cadastrado: volta à etapa 1 com o erro no campo e tudo preenchido', async () => {
  globalThis.__reg.api.registerUser = () =>
    Promise.reject(Object.assign(new Error('exists'), { code: 'user_already_exists' }))
  const view = await mount()
  await reachFinal(view)
  await view.click('Criar conta')
  assert.equal(view.title(), 'Crie sua conta')
  assert.ok(view.errors().includes('Este e-mail já está cadastrado.'))
  assert.equal(view.fields.email().props.value, 'maria@exemplo.com')
  assert.match(view.text(), /já está cadastrado/)
})

test('falha de rede ao criar: mensagem específica, dados mantidos, nova tentativa possível', async () => {
  let attempts = 0
  globalThis.__reg.api.registerUser = (...args) => {
    calls.push(['registerUser', ...args])
    attempts += 1
    return attempts === 1
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Promise.resolve({ user: { uid: 'u1' }, hasSession: true })
  }
  const view = await mount()
  await reachFinal(view)
  await view.click('Criar conta')
  assert.match(view.text(), /Sem conexão com o servidor/)
  assert.equal(view.title(), 'Tudo pronto para começar')
  await view.click('Criar conta')
  assert.equal(count('registerUser'), 2)
  assert.equal(count('complete'), 1)
})

test('@ ocupado ao concluir o perfil: volta à etapa 1 sem criar outra conta', async () => {
  let completes = 0
  globalThis.__reg.api.complete = (...args) => {
    calls.push(['complete', ...args])
    completes += 1
    return completes === 1 ? Promise.reject(new Error('USERNAME_TAKEN')) : Promise.resolve()
  }
  const view = await mount()
  await reachFinal(view)
  await view.click('Criar conta')
  assert.equal(view.title(), 'Crie sua conta')
  assert.ok(view.errors().includes('Esse nome de usuário já está em uso'))
  assert.match(view.text(), /Sua conta foi criada/)
  assert.equal(view.fields.email().props.disabled, undefined)
  await view.change('username', 'maria_fit2')
  await view.click('Continuar')
  await view.click('Continuar')
  await view.click('Concluir cadastro')
  assert.equal(count('registerUser'), 1, 'retentativa não cria outra conta')
  assert.equal(calls.filter((c) => c[0] === 'complete')[1][2].username, 'maria_fit2')
})

test('confirmação por código: OTP, reenvio com espera e conclusão do perfil', async () => {
  globalThis.__reg.api.registerUser = (...args) => {
    calls.push(['registerUser', ...args])
    return Promise.resolve({ user: { uid: 'u1' }, hasSession: false })
  }
  const view = await mount()
  await reachFinal(view)
  await view.click('Criar conta')
  assert.equal(view.title(), 'Confirme seu e-mail')
  assert.match(view.text(), /maria@exemplo.com/)
  assert.equal(view.button('Reenviar código (60s)').props.disabled, true)
  const otp = view.root().findByProps({ autoComplete: 'one-time-code' })
  await act(async () => otp.props.onChange({ target: { value: '12a3456' } }))
  assert.equal(view.root().findByProps({ autoComplete: 'one-time-code' }).props.value, '123456')
  await view.submit()
  assert.deepEqual(calls.find((c) => c[0] === 'confirm').slice(1), ['maria@exemplo.com', '123456', 'senha123'])
  assert.equal(count('complete'), 1)
  assert.equal(count('registerUser'), 1)
  assert.equal(calls.at(-1)[0], 'navigate')
})

test('usuário já autenticado que abre /cadastro vai para o app', async () => {
  globalThis.__reg.auth = { user: { uid: 'x' }, loading: false, refreshProfile() {} }
  const view = await mount()
  assert.equal(view.root().findByProps({ 'data-navigate': '/app' }).props['data-navigate'], '/app')
})

test('sem internet: aviso visível e dados continuam no formulário', async () => {
  globalThis.__reg.online = false
  const view = await mount()
  assert.match(view.text(), /Você está sem internet/)
})

test('Sexo é obrigatório; "Não informar" é uma escolha válida e permite avançar', async () => {
  const view = await mount()
  await fillStep1(view)
  await view.click('Continuar')
  await view.change('birthDate', '1995-05-10')
  await act(async () => view.root().findByProps({ 'data-pick-city': '2412500' }).props.onClick())
  const placeholder = sexoSelect(view).findAllByType('option')[0]
  assert.equal(placeholder.props.value, '')
  assert.equal(placeholder.props.disabled, true)
  assert.equal(placeholder.children.join(''), 'Selecione uma opção')
  await view.click('Continuar')
  assert.equal(view.title(), 'Conte um pouco sobre você', 'sem escolha não avança')
  assert.deepEqual(view.errors(), ['Selecione uma opção para Sexo'])
  await chooseSexo(view, 'nao_informar')
  assert.deepEqual(view.errors(), [], 'escolher limpa o erro')
  await view.click('Continuar')
  assert.equal(view.title(), 'Tudo pronto para começar')
})

test('INVALID_SEXO do servidor leva de volta à etapa 2 com o erro no campo', async () => {
  globalThis.__reg.api.complete = () => Promise.reject(new Error('INVALID_SEXO'))
  const view = await mount()
  await reachFinal(view)
  const original = console.error
  console.error = () => {}
  try {
    await view.click('Criar conta')
  } finally {
    console.error = original
  }
  assert.equal(view.title(), 'Conte um pouco sobre você')
  assert.ok(view.errors().includes('Selecione uma opção para Sexo'))
})
