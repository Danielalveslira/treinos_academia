import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let mod

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'auth-recovery-flow-tests-'))
  const outfile = join(directory, 'flow.cjs')
  await build({
    stdin: {
      contents: `
        export {
          registerUser,
          emailFirstSignupReady,
          requestEmailFirstSignup,
          confirmEmailFirstOtp,
          syncEmailFirstPassword,
          confirmSignupOtp,
          confirmSignupAndSyncPassword,
          sendVerificationEmail,
          resetPassword,
          verifyRecoveryToken,
          updatePassword,
          syncSignupPassword,
          revokeOtherSessionsRequired,
        } from './authService.js'
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '"http://127.0.0.1:54321"',
      'import.meta.env.VITE_HCAPTCHA_ENABLED': '"false"',
    },
    plugins: [
      {
        name: 'supabase-stub',
        setup(ctx) {
          ctx.onResolve({ filter: /supabase\/config$/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
            contents: `export const supabase = {
              auth: {
                signUp: (...a) => globalThis.__signUp(...a),
                signInWithOtp: (...a) => globalThis.__signInWithOtp(...a),
                verifyOtp: (...a) => globalThis.__verifyOtp(...a),
                resend: (...a) => globalThis.__resend(...a),
                resetPasswordForEmail: (...a) => globalThis.__resetPasswordForEmail(...a),
                updateUser: (...a) => globalThis.__updateUser(...a),
                signOut: (...a) => globalThis.__signOut(...a),
                getSession: () => globalThis.__getSession(),
              },
              rpc: (...a) => globalThis.__rpc(...a),
              functions: { invoke: (...a) => globalThis.__invoke(...a) },
            }`,
          }))
        },
      },
    ],
  })
  mod = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

let calls
beforeEach(() => {
  calls = []
  // Padrão: logout local sempre "limpo" (sem sessão residual) -- só os testes que
  // precisam simular uma sessão ainda ativa após uma falha de signOut sobrescrevem isto.
  globalThis.__signOut = () => Promise.resolve({ error: null })
  globalThis.__getSession = () => Promise.resolve({ data: { session: null } })
  globalThis.__rpc = () => Promise.resolve({ data: false, error: null })
  globalThis.__invoke = () => Promise.resolve({ data: { code: 'PASSWORD_READY' }, error: null })
})

const quiet = async (fn) => {
  const warn = console.warn
  const error = console.error
  console.warn = () => {}
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.warn = warn
    console.error = error
  }
}

test('emailFirstSignupReady: migration ausente mantém o cadastro convencional', async () => {
  globalThis.__rpc = () => Promise.resolve({ data: null, error: { code: 'PGRST202' } })
  assert.equal(await mod.emailFirstSignupReady(), false)
})

test('emailFirstSignupReady: falha de rede não ativa o novo fluxo', async () => {
  globalThis.__rpc = () => Promise.resolve({ data: null, error: new Error('network') })
  await assert.rejects(mod.emailFirstSignupReady(), /network/)
})

test('registerUser: sessão inesperada é encerrada e não cria perfil', async () => {
  globalThis.__signOut = (...args) => {
    calls.push(['signOut', ...args])
    return Promise.resolve({ error: null })
  }
  globalThis.__signUp = (args) => {
    calls.push(args)
    return Promise.resolve({
      data: { user: { id: 'u1', email: 'a@a.com' }, session: { access_token: 'x' } },
      error: null,
    })
  }
  const result = await mod.registerUser('a@a.com', 'senha1234')
  assert.deepEqual(result, {
    user: null,
    hasSession: false,
    outcome: 'unexpected_session',
  })
  assert.deepEqual(calls.at(-1), ['signOut', { scope: 'local' }])
})

test('registerUser: falha ao encerrar sessão inesperada bloqueia o cadastro', async () => {
  globalThis.__signUp = () => Promise.resolve({
    data: { user: { id: 'u1', email: 'a@a.com' }, session: { access_token: 'x' } },
    error: null,
  })
  globalThis.__signOut = () => Promise.resolve({ error: new Error('network') })
  globalThis.__getSession = () => Promise.resolve({ data: { session: { access_token: 'x' } } })
  await assert.rejects(mod.registerUser('a@a.com', 'senha1234'), {
    code: 'SIGNUP_UNEXPECTED_SESSION',
  })
})

test('registerUser: sem sessão não usa o UID como identidade confirmada', async () => {
  globalThis.__signUp = () =>
    Promise.resolve({ data: { user: { id: 'u1', email: 'a@a.com' }, session: null }, error: null })
  const result = await mod.registerUser('a@a.com', 'senha1234')
  assert.deepEqual(result, { user: null, hasSession: false, outcome: 'verification_required' })
})

// Confirmado nos logs de Auth de PRODUÇÃO (evento "User repeated signup"): signUp num
// e-mail JÁ CONFIRMADO, com Confirm email ligado, responde 200 sem erro e sem sessão --
// um usuário ofuscado (identities vazio), sem enviar e-mail nenhum. Diverge do GoTrue
// local (CLI), que devolve 422 user_already_exists para o mesmo caso (ver
// KNOWN_LIMITATIONS.md). registerUser normaliza ambos para hasSession:false e não
// entrega o UID sem uma sessão confirmada; a interface segue pelo mesmo caminho.
test('registerUser: signUp ofuscado (e-mail já confirmado, hospedado) também dá hasSession:false', async () => {
  globalThis.__signUp = () =>
    Promise.resolve({
      data: {
        user: { id: 'u1', email: 'a@a.com', identities: [] },
        session: null,
      },
      error: null,
    })
  const result = await mod.registerUser('a@a.com', 'outraSenhaQualquer')
  assert.deepEqual(result, { user: null, hasSession: false, outcome: 'verification_required' })
})

test('registerUser: erro explícito de e-mail existente tem o mesmo resultado sem sessão', async () => {
  const error = new Error('email_exists')
  error.code = 'email_exists'
  globalThis.__signUp = () => Promise.resolve({ data: null, error })
  assert.deepEqual(await mod.registerUser('a@a.com', 'senha1234'), {
    user: null,
    hasSession: false,
    outcome: 'verification_required',
  })
})

test('registerUser: resposta de transporte perdida permite OTP sem repetir signUp', async () => {
  globalThis.__signUp = () => Promise.reject(new TypeError('Failed to fetch'))
  assert.deepEqual(await mod.registerUser('a@a.com', 'senha1234'), {
    user: null,
    hasSession: false,
    outcome: 'request_uncertain',
  })
})

test('registerUser: erro de transporte retornado pelo SDK também é incerto', async () => {
  const error = new Error('Failed to fetch')
  error.name = 'AuthRetryableFetchError'
  globalThis.__signUp = () => Promise.resolve({ data: null, error })
  assert.deepEqual(await mod.registerUser('a@a.com', 'senha1234'), {
    user: null,
    hasSession: false,
    outcome: 'request_uncertain',
  })
})

test('registerUser: falha real de envio não é tratada como confirmação pendente', async () => {
  const error = new Error('smtp unavailable')
  error.code = 'email_provider_disabled'
  globalThis.__signUp = () => Promise.resolve({ data: null, error })
  await assert.rejects(mod.registerUser('a@a.com', 'senha1234'), /smtp unavailable/)
})

test('confirmSignupOtp: troca o código pelo tipo signup e devolve uid/email', async () => {
  globalThis.__verifyOtp = (args) => {
    calls.push(args)
    return Promise.resolve({ data: { user: { id: 'u1', email: 'a@a.com' } }, error: null })
  }
  const result = await mod.confirmSignupOtp('a@a.com', '123456')
  assert.deepEqual(calls, [{ email: 'a@a.com', token: '123456', type: 'signup' }])
  assert.deepEqual(result, { uid: 'u1', email: 'a@a.com' })
})

test('confirmSignupOtp: código inválido/expirado propaga o erro do GoTrue', async () => {
  globalThis.__verifyOtp = () => Promise.resolve({ data: null, error: new Error('otp_expired') })
  await assert.rejects(mod.confirmSignupOtp('a@a.com', '000000'), /otp_expired/)
})

test('sendVerificationEmail: reenvia por e-mail (type signup), sem depender de sessão', async () => {
  globalThis.__resend = (args) => {
    calls.push(args)
    return Promise.resolve({ error: null })
  }
  await mod.sendVerificationEmail('a@a.com')
  assert.deepEqual(calls, [{ type: 'signup', email: 'a@a.com' }])
})

test('resetPassword: chama resetPasswordForEmail sem redirectTo (o template usa SiteURL fixo)', async () => {
  globalThis.__resetPasswordForEmail = (...args) => {
    calls.push(args)
    return Promise.resolve({ error: null })
  }
  await mod.resetPassword('a@a.com')
  assert.deepEqual(calls, [['a@a.com']])
})

test('verifyRecoveryToken: troca token_hash por sessão com type recovery', async () => {
  globalThis.__verifyOtp = (args) => {
    calls.push(args)
    return Promise.resolve({ error: null })
  }
  await mod.verifyRecoveryToken('hash123')
  assert.deepEqual(calls, [{ token_hash: 'hash123', type: 'recovery' }])
})

test('verifyRecoveryToken: link expirado/já usado propaga o erro', async () => {
  globalThis.__verifyOtp = () => Promise.resolve({ error: new Error('otp_expired') })
  await assert.rejects(mod.verifyRecoveryToken('hash123'), /otp_expired/)
})

test('updatePassword: chama updateUser com a nova senha', async () => {
  globalThis.__updateUser = (args) => {
    calls.push(args)
    return Promise.resolve({ error: null })
  }
  await mod.updatePassword('novaSenha1')
  assert.deepEqual(calls, [{ password: 'novaSenha1' }])
})

// --- syncSignupPassword: agora LANÇA (nunca best-effort) -- é a base do failsafe de
// pre-account hijacking de confirmSignupAndSyncPassword abaixo. ---

test('syncSignupPassword: alinha a senha da conta com o que está no formulário agora', async () => {
  globalThis.__updateUser = (args) => {
    calls.push(args)
    return Promise.resolve({ error: null })
  }
  await mod.syncSignupPassword('senhaMaisRecente1')
  assert.deepEqual(calls, [{ password: 'senhaMaisRecente1' }])
})

test('syncSignupPassword: senha vazia LANÇA (nunca prossegue sem senha para confirmar)', async () => {
  globalThis.__updateUser = () => {
    throw new Error('não deveria ser chamado')
  }
  await assert.rejects(mod.syncSignupPassword(''), /MISSING_PASSWORD/)
  await assert.rejects(mod.syncSignupPassword(undefined), /MISSING_PASSWORD/)
})

test('syncSignupPassword: falha do updateUser PROPAGA (quem chama deve falhar de forma fechada)', async () => {
  globalThis.__updateUser = () => Promise.resolve({ error: new Error('network') })
  await assert.rejects(mod.syncSignupPassword('senhaMaisRecente1'), /network/)
})

test('syncSignupPassword: same_password é tratado como SUCESSO -- cadastro normal, sem reload', async () => {
  // Reproduzido em produção e localmente: no cadastro normal (sem ataque, sem reload), a
  // senha do formulário É a mesma que o signUp acabou de gravar -- updateUser rejeita
  // com same_password, o que PROVA a senha certa, nunca o contrário.
  const samePasswordError = new Error('same_password')
  samePasswordError.code = 'same_password'
  globalThis.__updateUser = () => Promise.resolve({ error: samePasswordError })
  await mod.syncSignupPassword('senhaDoCadastro1')
})

test('syncSignupPassword: qualquer OUTRO erro continua fail-closed, same_password não abre exceção geral', async () => {
  const otherError = new Error('rate limit')
  otherError.code = 'over_request_rate_limit'
  globalThis.__updateUser = () => Promise.resolve({ error: otherError })
  await assert.rejects(mod.syncSignupPassword('senhaDoCadastro1'), /rate limit/)
})

// --- confirmSignupAndSyncPassword: reproduz em unidade a defesa contra pre-account
// hijacking (ver nota em authService.js) -- updateUser SEMPRE recebe a senha do
// formulário, nunca lê ou depende da senha que já estava na conta (seja ela a de um
// atacante ou não); e uma falha ao confirmá-la encerra a sessão em vez de conceder
// acesso. ---

test('confirmSignupAndSyncPassword: feliz -- confirma e alinha a senha do formulário, sem logout', async () => {
  const signOutCalls = []
  globalThis.__verifyOtp = () =>
    Promise.resolve({ data: { user: { id: 'u1', email: 'vitima@a.com' } }, error: null })
  globalThis.__updateUser = (args) => {
    calls.push(args)
    return Promise.resolve({ error: null })
  }
  globalThis.__signOut = (args) => {
    signOutCalls.push(args)
    return Promise.resolve({ error: null })
  }
  const confirmed = await mod.confirmSignupAndSyncPassword(
    'vitima@a.com',
    '123456',
    'senhaDaVitima1'
  )
  assert.deepEqual(confirmed, { uid: 'u1', email: 'vitima@a.com' })
  // A senha aplicada é exatamente a do formulário (nunca a que já estava na conta,
  // seja de um cadastro legítimo anterior ou de um atacante).
  assert.deepEqual(calls, [{ password: 'senhaDaVitima1' }])
  assert.deepEqual(signOutCalls, [])
})

test('confirmSignupAndSyncPassword: cadastro NORMAL (same_password) completa sem cair em PASSWORD_SYNC_FAILED', async () => {
  const signOutCalls = []
  globalThis.__verifyOtp = () =>
    Promise.resolve({ data: { user: { id: 'u1', email: 'pessoa@a.com' } }, error: null })
  const samePasswordError = new Error('same_password')
  samePasswordError.code = 'same_password'
  globalThis.__updateUser = () => Promise.resolve({ error: samePasswordError })
  globalThis.__signOut = (args) => {
    signOutCalls.push(args)
    return Promise.resolve({ error: null })
  }
  await mod.confirmSignupAndSyncPassword('pessoa@a.com', '123456', 'senhaDoCadastro1')
  // Nenhum logout -- é exatamente o caminho que antes da correção caía em 'locked'.
  assert.deepEqual(signOutCalls, [])
})

test('confirmSignupAndSyncPassword: código errado/expirado propaga sem tocar em senha ou sessão', async () => {
  globalThis.__verifyOtp = () => Promise.resolve({ data: null, error: new Error('otp_expired') })
  globalThis.__updateUser = () => {
    throw new Error('não deveria ser chamado')
  }
  globalThis.__signOut = () => {
    throw new Error('não deveria ser chamado')
  }
  await assert.rejects(
    mod.confirmSignupAndSyncPassword('a@a.com', '000000', 'senha1'),
    /otp_expired/
  )
})

test('confirmSignupAndSyncPassword: FALHA FECHADA -- código certo mas senha não confirmável encerra a sessão', async () => {
  const signOutCalls = []
  globalThis.__verifyOtp = () =>
    Promise.resolve({ data: { user: { id: 'u1', email: 'vitima@a.com' } }, error: null })
  globalThis.__updateUser = () => Promise.resolve({ error: new Error('network') })
  globalThis.__signOut = (args) => {
    signOutCalls.push(args)
    return Promise.resolve({ error: null })
  }
  await quiet(async () => {
    const err = await mod
      .confirmSignupAndSyncPassword('vitima@a.com', '123456', 'senhaDaVitima1')
      .catch((e) => e)
    assert.equal(err?.code, 'PASSWORD_SYNC_FAILED')
  })
  // logoutUser (local) foi chamado -- a sessão recém-criada NUNCA fica de pé sem senha
  // confirmada, por isso nunca chega a conceder acesso ao app (ver Register.jsx: cai no
  // passo 'locked', nunca em completeProfile).
  assert.deepEqual(signOutCalls, [{ scope: 'local' }])
})

test('revokeOtherSessionsRequired: falha de revogação é propagada para retentativa', async () => {
  globalThis.__signOut = (args) => {
    calls.push(args)
    return Promise.resolve({ error: new Error('network') })
  }
  await assert.rejects(mod.revokeOtherSessionsRequired(), /network/)
  assert.deepEqual(calls, [{ scope: 'others' }])
})
