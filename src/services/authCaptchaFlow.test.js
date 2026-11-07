import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let auth
let pricing
let missingConfig
let localAuth
let conflictAuth
const calls = []

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'auth-captcha-flow-'))
  const supabaseStub = {
    name: 'supabase-stub',
    setup(context) {
      context.onResolve({ filter: /supabase\/config$/ }, () => ({
        path: 'supabase',
        namespace: 'stub',
      }))
      context.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
        contents: `export const supabase = { auth: {
          signUp: (arg) => globalThis.__captchaCall('signUp', arg),
          signInWithPassword: (arg) => globalThis.__captchaCall('signInWithPassword', arg),
          resend: (arg) => globalThis.__captchaCall('resend', arg),
          resetPasswordForEmail: (...arg) => globalThis.__captchaCall('resetPasswordForEmail', ...arg),
          getUser: () => Promise.resolve({ data: { user: { id: 'u1', email: 'a@example.com' } }, error: null }),
        } }`,
      }))
    },
  }
  const outfile = join(directory, 'flow.cjs')
  await build({
    stdin: {
      contents: `export * as auth from './authService.js'; export * as pricing from './evocashPricingService.js'`,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '"https://project.supabase.co"',
      'import.meta.env.VITE_HCAPTCHA_ENABLED': '"true"',
      'import.meta.env.VITE_HCAPTCHA_SITE_KEY': '"public-test-key"',
    },
    plugins: [supabaseStub],
  })
  ;({ auth, pricing } = createRequire(import.meta.url)(outfile))
  for (const [name, url, enabled] of [
    ['local', 'http://127.0.0.1:54321', 'false'],
    ['conflict', 'https://project.supabase.co', 'false'],
  ]) {
    const file = join(directory, `${name}.cjs`)
    await build({
      entryPoints: [new URL('./authService.js', import.meta.url).pathname],
      outfile: file,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
        'import.meta.env.VITE_HCAPTCHA_ENABLED': JSON.stringify(enabled),
        'import.meta.env.VITE_HCAPTCHA_SITE_KEY': '""',
      },
      plugins: [supabaseStub],
    })
    if (name === 'local') localAuth = createRequire(import.meta.url)(file)
    else conflictAuth = createRequire(import.meta.url)(file)
  }
  const missingFile = join(directory, 'missing.cjs')
  await build({
    entryPoints: [new URL('../utils/authCaptcha.js', import.meta.url).pathname],
    outfile: missingFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '"https://project.supabase.co"',
      'import.meta.env.VITE_HCAPTCHA_ENABLED': 'undefined',
      'import.meta.env.VITE_HCAPTCHA_SITE_KEY': '""',
    },
  })
  missingConfig = createRequire(import.meta.url)(missingFile)
  globalThis.__captchaCall = (name, ...args) => {
    calls.push([name, ...args])
    if (name === 'signUp')
      return Promise.resolve({
        data: { user: { id: 'u1', email: 'a@example.com' }, session: {} },
        error: null,
      })
    return Promise.resolve({ data: { user: { id: 'u1' } }, error: null })
  }
})

after(async () => {
  delete globalThis.__captchaCall
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('token público é enviado em cadastro, login, recuperação, reenvio e reautenticação', async () => {
  calls.length = 0
  await auth.registerUser('a@example.com', 'password', 'signup-token')
  await auth.loginUser('a@example.com', 'password', 'login-token')
  await auth.resetPassword('a@example.com', 'recovery-token')
  await auth.sendVerificationEmail('a@example.com', 'resend-token')
  await pricing.reauthenticatePricingAdmin('password', 'admin-token')
  assert.deepEqual(
    calls.map(([name]) => name),
    ['signUp', 'signInWithPassword', 'resetPasswordForEmail', 'resend', 'signInWithPassword']
  )
  assert.equal(calls[0][1].options.captchaToken, 'signup-token')
  assert.equal(calls[1][1].options.captchaToken, 'login-token')
  assert.equal(calls[2][2].captchaToken, 'recovery-token')
  assert.equal(calls[3][1].options.captchaToken, 'resend-token')
  assert.equal(calls[4][1].options.captchaToken, 'admin-token')
})

test('token ausente bloqueia todas as operações antes de chamar Supabase', async () => {
  calls.length = 0
  for (const action of [
    () => auth.registerUser('a@example.com', 'password'),
    () => auth.loginUser('a@example.com', 'password'),
    () => auth.resetPassword('a@example.com'),
    () => auth.sendVerificationEmail('a@example.com'),
    () => pricing.reauthenticatePricingAdmin('password'),
  ])
    await assert.rejects(action(), { code: 'CAPTCHA_REQUIRED' })
  assert.equal(calls.length, 0)
})

test('rejeição do servidor é propagada para permitir novo desafio', async () => {
  calls.length = 0
  globalThis.__captchaCall = (name, ...args) => {
    calls.push([name, ...args])
    return Promise.resolve({
      error: Object.assign(new Error('rejected'), { code: 'captcha_failed' }),
    })
  }
  await assert.rejects(auth.loginUser('a@example.com', 'password', 'rejected-token'), {
    code: 'captcha_failed',
  })
  assert.equal(calls.length, 1)
})

test('produção sem chave pública falha fechada', () => {
  assert.equal(missingConfig.authCaptchaRequired, true)
  assert.throws(() => missingConfig.captchaOptions('any-token'), {
    code: 'CAPTCHA_CONFIGURATION_MISSING',
  })
})

test('Supabase local sem proteção permite login sem token; hospedado com false bloqueia', async () => {
  calls.length = 0
  globalThis.__captchaCall = (name, ...args) => {
    calls.push([name, ...args])
    return Promise.resolve({ data: { user: { id: 'u1' } }, error: null })
  }
  await localAuth.loginUser('a@example.com', 'password')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1].options, undefined)
  calls.length = 0
  await assert.rejects(conflictAuth.loginUser('a@example.com', 'password'), {
    code: 'CAPTCHA_CONFIGURATION_CONFLICT',
  })
  assert.equal(calls.length, 0)
})

test('política exige CAPTCHA em dev hospedado, preview e produção sem depender de PROD', () => {
  const resolve = missingConfig.resolveAuthCaptchaConfig
  const hosted = { VITE_SUPABASE_URL: 'https://project.supabase.co' }
  assert.deepEqual(resolve({ ...hosted, VITE_HCAPTCHA_SITE_KEY: 'public-key' }), {
    required: true,
    siteKey: 'public-key',
    error: null,
  })
  assert.deepEqual(resolve({ ...hosted, VITE_HCAPTCHA_ENABLED: 'false' }), {
    required: true,
    siteKey: '',
    error: 'CAPTCHA_CONFIGURATION_CONFLICT',
  })
  assert.equal(
    resolve({ ...hosted, VITE_HCAPTCHA_ENABLED: 'perhaps' }).error,
    'CAPTCHA_CONFIGURATION_CONFLICT'
  )
  assert.equal(resolve({ ...hosted }).error, 'CAPTCHA_CONFIGURATION_MISSING')
  assert.equal(resolve({ VITE_HCAPTCHA_ENABLED: 'false' }).required, true)
  assert.deepEqual(
    resolve({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_HCAPTCHA_ENABLED: 'false' }),
    {
      required: false,
      siteKey: '',
      error: null,
    }
  )
  assert.equal(
    resolve({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_HCAPTCHA_ENABLED: 'true' }).error,
    'CAPTCHA_CONFIGURATION_MISSING'
  )
})
