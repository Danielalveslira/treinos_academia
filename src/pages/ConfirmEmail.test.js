import { after, afterEach, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

// Página avulsa de confirmação (ver nota em ConfirmEmail.jsx). Cobre especificamente o
// achado do CAPTCHA: "Confirmar" nunca depende dele (verifyOtp não aceita CAPTCHA, é
// @deprecated no SDK -- a defesa real é o rate limit nativo de tentativas), mas "Reenviar
// código" (resend, que aceita CAPTCHA de verdade) fica bloqueado até a verificação. Serviços
// e o CAPTCHA são substituídos; validators, NewPasswordFields e o fluxo da página são reais.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const require = createRequire(import.meta.url)
let directory
let ConfirmEmail

const STUBS = {
  primer: `
    import { forwardRef } from 'react'
    export const FormControl = ({ children }) => <div>{children}</div>
    FormControl.Label = ({ children }) => <label>{children}</label>
    FormControl.Caption = ({ children }) => <small>{children}</small>
    export const TextInput = forwardRef(({ ...props }, ref) => <input ref={ref} {...props} />)
    export const Button = ({ children, loading, variant, size, block, as, ...props }) => <button {...props}>{children}</button>
    export const Link = ({ children, as, to, ...props }) => <a href={to} {...props}>{children}</a>
    export const Flash = ({ children, variant, ...props }) => <div data-flash={variant || 'default'} {...props}>{children}</div>
    export const Stack = ({ children }) => <div>{children}</div>
  `,
  router: `
    export const Link = ({ children, to }) => <a href={to}>{children}</a>
    export const useNavigate = () => (...args) => globalThis.__confirmEmail.navigate(...args)
    export const useLocation = () => globalThis.__confirmEmail.location
  `,
  analytics: `export const trackAuthEvent = () => {}; export const reportAuthOutcome = () => {}`,
  layout: `
    export const AuthLayout = ({ title, description, children, footer }) => (
      <main>
        <h1>{title}</h1>
        <p>{description}</p>
        {children}
        <footer>{footer}</footer>
      </main>
    )
  `,
  auth: `
    export const confirmSignupOtp = (...a) => globalThis.__confirmEmail.api.confirm(...a)
    export const sendVerificationEmail = (...a) => globalThis.__confirmEmail.api.resend(...a)
    export const updatePassword = (...a) => globalThis.__confirmEmail.api.setPassword(...a)
    export const revokeOtherSessionsRequired = (...a) => globalThis.__confirmEmail.api.revokeOthers(...a)
    export const logoutUser = (...a) => globalThis.__confirmEmail.api.logout(...a)
    export const emailFirstSignupReady = (...a) => globalThis.__confirmEmail.api.ready(...a)
  `,
  // Substitui só o widget interno (igual AuthCaptcha.test.js faz com @hcaptcha/react-hcaptcha);
  // a verificação em si é simulada por um botão, sem depender de rede nem de um CAPTCHA real.
  captcha: `
    import { forwardRef, useImperativeHandle } from 'react'
    export const AuthCaptcha = forwardRef(function FakeCaptcha({ onVerifiedChange }, ref) {
      useImperativeHandle(ref, () => ({
        takeToken: () => globalThis.__confirmEmail.captchaToken,
        reset: () => { globalThis.__confirmEmail.captchaToken = null; onVerifiedChange(false) },
      }))
      return (
        <button
          type="button"
          data-fake-captcha="true"
          onClick={() => { globalThis.__confirmEmail.captchaToken = 'fake-captcha-token'; onVerifiedChange(true) }}
        >
          Simular verificação
        </button>
      )
    })
  `,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'confirm-email-tests-'))
  const outfile = join(directory, 'confirm.cjs')
  await build({
    stdin: {
      contents: `export { default as ConfirmEmail } from './ConfirmEmail.jsx'`,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    define: {
      // CAPTCHA genuinamente exigido (URL "hospedada" + site key) -- é exatamente o cenário
      // que expôs o achado: precisa provar o gate de verdade, não um ambiente onde ele vira no-op.
      'import.meta.env.VITE_SUPABASE_URL': '"https://project.supabase.co"',
      'import.meta.env.VITE_HCAPTCHA_ENABLED': '"true"',
      'import.meta.env.VITE_HCAPTCHA_SITE_KEY': '"public-test-key"',
    },
    plugins: [
      {
        name: 'confirm-email-stubs',
        setup(context) {
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          for (const [filter, path] of [
            [/^@primer\/react$/, 'primer'],
            [/^react-router-dom$/, 'router'],
            [/\/components\/PublicLayout$/, 'layout'],
            [/\/services\/authService$/, 'auth'],
            [/\/components\/AuthCaptcha$/, 'captcha'],
            [/\/utils\/authAnalytics$/, 'analytics'],
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
  ;({ ConfirmEmail } = require(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const mounted = []
afterEach(async () => {
  await act(async () => {
    while (mounted.length) mounted.pop().unmount()
  })
})
beforeEach(() => {
  globalThis.__confirmEmail = {
    navigate: () => {},
    location: { state: null },
    captchaToken: null,
    api: {
      ready: () => Promise.resolve(false),
      confirm: () => Promise.resolve({ uid: 'u1', email: 'a@exemplo.com' }),
      resend: () => Promise.resolve(),
      setPassword: () => Promise.resolve(),
      revokeOthers: () => Promise.resolve(),
      logout: () => Promise.resolve({ revoked: true }),
    },
  }
})

async function mount() {
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(ConfirmEmail))
  })
  mounted.push(renderer)
  // Deixa o useEffect de emailFirstSignupReady() resolver antes do teste seguir.
  await act(async () => {})
  const root = () => renderer.root
  const confirmButton = () => root().findAllByType('button').find((b) => b.props.children === 'Confirmar')
  const resendButton = () => root().findAllByType('button').find((b) => String(b.props.children).startsWith('Reenviar'))
  const fakeCaptchaButton = () => root().findByProps({ 'data-fake-captcha': 'true' })
  const inputs = () => root().findAllByType('input')
  const emailInput = () => inputs().find((i) => i.props.autoComplete === 'email')
  const otpInput = () => inputs().find((i) => i.props.autoComplete === 'one-time-code')
  return { renderer, root, confirmButton, resendButton, fakeCaptchaButton, emailInput, otpInput }
}

test('Confirmar nunca fica bloqueado pelo CAPTCHA (verifyOtp não o aceita)', async () => {
  const { confirmButton, emailInput, otpInput } = await mount()
  await act(async () => {
    emailInput().props.onChange({ target: { value: 'a@exemplo.com' } })
    otpInput().props.onChange({ target: { value: '123456' } })
  })
  // Sem nunca clicar no CAPTCHA: Confirmar já deve estar habilitado só com e-mail + 6 dígitos.
  assert.equal(confirmButton().props.disabled, false)
})

test('Reenviar código fica bloqueado até a verificação de segurança ser concluída', async () => {
  const { resendButton, fakeCaptchaButton, emailInput } = await mount()
  await act(async () => {
    emailInput().props.onChange({ target: { value: 'a@exemplo.com' } })
  })
  assert.equal(resendButton().props.disabled, true)
  await act(async () => {
    fakeCaptchaButton().props.onClick()
  })
  assert.equal(resendButton().props.disabled, false)
})

test('Reenviar código sem e-mail preenchido continua bloqueado mesmo com CAPTCHA verificado', async () => {
  const { resendButton, fakeCaptchaButton } = await mount()
  await act(async () => {
    fakeCaptchaButton().props.onClick()
  })
  assert.equal(resendButton().props.disabled, true)
})

test('confirmar com código correto avança para a etapa de definir senha', async () => {
  const { confirmButton, emailInput, otpInput, root } = await mount()
  await act(async () => {
    emailInput().props.onChange({ target: { value: 'a@exemplo.com' } })
    otpInput().props.onChange({ target: { value: '654321' } })
  })
  assert.equal(confirmButton().props.disabled, false)
  await act(async () => {
    root().findByProps({ className: 'public-form' }).props.onSubmit({ preventDefault() {} })
  })
  assert.equal(root().findByType('h1').children.join(''), 'Defina uma senha para sua conta')
})

test('reenviar com CAPTCHA verificado chama sendVerificationEmail com o token e reseta o widget', async () => {
  const calls = []
  globalThis.__confirmEmail.api.resend = (...args) => { calls.push(args); return Promise.resolve() }
  const { resendButton, fakeCaptchaButton, emailInput } = await mount()
  await act(async () => {
    emailInput().props.onChange({ target: { value: 'a@exemplo.com' } })
    fakeCaptchaButton().props.onClick()
  })
  await act(async () => {
    await resendButton().props.onClick()
  })
  assert.deepEqual(calls, [['a@exemplo.com', 'fake-captcha-token']])
  // O widget é resetado depois do reenvio -- uma nova verificação é exigida para o próximo envio.
  assert.equal(resendButton().props.disabled, true)
})

test('falha ao revogar sessões mantém a etapa e retenta sem trocar a senha outra vez', async () => {
  const calls = []
  globalThis.__confirmEmail.api.setPassword = () => { calls.push('password'); return Promise.resolve() }
  globalThis.__confirmEmail.api.revokeOthers = () => {
    calls.push('others')
    return calls.filter((item) => item === 'others').length === 1
      ? Promise.reject(new Error('network')) : Promise.resolve()
  }
  globalThis.__confirmEmail.api.logout = () => { calls.push('local'); return Promise.resolve({ revoked: true }) }
  globalThis.__confirmEmail.navigate = () => { calls.push('navigate') }
  const { emailInput, otpInput, root } = await mount()
  await act(async () => {
    emailInput().props.onChange({ target: { value: 'a@exemplo.com' } })
    otpInput().props.onChange({ target: { value: '123456' } })
  })
  await act(async () => {
    await root().findByProps({ className: 'public-form' }).props.onSubmit({ preventDefault() {} })
  })
  const passwordInput = root().findAllByType('input').find((input) => input.props.autoComplete === 'new-password')
  const confirmationInput = root().findAllByType('input').filter((input) => input.props.autoComplete === 'new-password')[1]
  await act(async () => {
    passwordInput.props.onChange({ target: { value: 'senhaNovaSegura12345' } })
    confirmationInput.props.onChange({ target: { value: 'senhaNovaSegura12345' } })
  })
  await act(async () => {
    await root().findByProps({ className: 'public-form' }).props.onSubmit({ preventDefault() {} })
  })
  assert.deepEqual(calls, ['password', 'others'])
  assert.ok(root().findAllByProps({ role: 'alert' }).length > 0)
  await act(async () => {
    await root().findByProps({ className: 'public-form' }).props.onSubmit({ preventDefault() {} })
  })
  assert.deepEqual(calls, ['password', 'others', 'others', 'local', 'navigate'])
})

test('saída local sem revogação confirmada não anuncia conclusão segura', async () => {
  let destination
  globalThis.__confirmEmail.api.logout = () => Promise.resolve({ revoked: false })
  globalThis.__confirmEmail.navigate = (...args) => { destination = args }
  const { emailInput, otpInput, root } = await mount()
  await act(async () => {
    emailInput().props.onChange({ target: { value: 'a@exemplo.com' } })
    otpInput().props.onChange({ target: { value: '123456' } })
  })
  await act(async () => {
    await root().findByProps({ className: 'public-form' }).props.onSubmit({ preventDefault() {} })
  })
  const inputs = root().findAllByType('input').filter((input) => input.props.autoComplete === 'new-password')
  await act(async () => {
    for (const input of inputs) input.props.onChange({ target: { value: 'senhaNovaSegura12345' } })
  })
  await act(async () => {
    await root().findByProps({ className: 'public-form' }).props.onSubmit({ preventDefault() {} })
  })
  assert.deepEqual(destination, ['/login', { replace: true, state: { passwordResetRevocationPending: true } }])
})
