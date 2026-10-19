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
          confirmSignupOtp,
          confirmSignupAndSyncPassword,
          sendVerificationEmail,
          resetPassword,
          verifyRecoveryToken,
          updatePassword,
          syncSignupPassword,
          setPasswordAfterConfirmation,
          endOtherSessions,
        } from './authService.js'
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
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
                verifyOtp: (...a) => globalThis.__verifyOtp(...a),
                resend: (...a) => globalThis.__resend(...a),
                resetPasswordForEmail: (...a) => globalThis.__resetPasswordForEmail(...a),
                updateUser: (...a) => globalThis.__updateUser(...a),
                signOut: (...a) => globalThis.__signOut(...a),
                getSession: () => globalThis.__getSession(),
              },
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

test('registerUser: com Confirm email desligado (autoconfirm), devolve hasSession:true', async () => {
  globalThis.__signUp = (args) => {
    calls.push(args)
    return Promise.resolve({
      data: { user: { id: 'u1', email: 'a@a.com' }, session: { access_token: 'x' } },
      error: null,
    })
  }
  const result = await mod.registerUser('a@a.com', 'senha1234')
  assert.deepEqual(result, { user: { uid: 'u1', email: 'a@a.com' }, hasSession: true })
})

test('registerUser: com Confirm email ligado, data.session vem null -> hasSession:false', async () => {
  globalThis.__signUp = () =>
    Promise.resolve({ data: { user: { id: 'u1', email: 'a@a.com' }, session: null }, error: null })
  const result = await mod.registerUser('a@a.com', 'senha1234')
  assert.deepEqual(result, { user: { uid: 'u1', email: 'a@a.com' }, hasSession: false })
})

// Confirmado nos logs de Auth de PRODUÇÃO (evento "User repeated signup"): signUp num
// e-mail JÁ CONFIRMADO, com Confirm email ligado, responde 200 sem erro e sem sessão --
// um usuário ofuscado (identities vazio), sem enviar e-mail nenhum. Diverge do GoTrue
// local (CLI), que devolve 422 user_already_exists para o mesmo caso (ver
// KNOWN_LIMITATIONS.md). registerUser não distingue isso do caso legítimo "aguardando
// confirmação" -- hasSession:false nos dois, de propósito: não há sinal nenhum (nem aqui
// nem em Register.jsx/handleSubmit) que ramifique a UI por identities/erro específico, só
// por hasSession. É isso que torna a tela de código seguinte neutra por construção, não
// por uma checagem explícita de "é ofuscado?".
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
  assert.deepEqual(result, { user: { uid: 'u1', email: 'a@a.com' }, hasSession: false })
})

test('registerUser: erro do GoTrue (ex.: email já cadastrado) propaga', async () => {
  globalThis.__signUp = () => Promise.resolve({ data: null, error: new Error('email_exists') })
  await assert.rejects(mod.registerUser('a@a.com', 'senha1234'), /email_exists/)
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
  await mod.confirmSignupAndSyncPassword('vitima@a.com', '123456', 'senhaDaVitima1')
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
  await assert.rejects(mod.confirmSignupAndSyncPassword('a@a.com', '000000', 'senha1'), /otp_expired/)
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

// --- setPasswordAfterConfirmation: usada por ConfirmEmail.jsx, onde NENHUMA senha é
// conhecida de antemão -- sempre define uma senha nova e encerra outras sessões (ex.: a
// de um possível atacante já logado com a senha antiga). ---

test('setPasswordAfterConfirmation: define a senha, encerra outras sessões e esta também', async () => {
  const signOutCalls = []
  globalThis.__updateUser = (args) => {
    calls.push(args)
    return Promise.resolve({ error: null })
  }
  globalThis.__signOut = (args) => {
    signOutCalls.push(args)
    return Promise.resolve({ error: null })
  }
  await mod.setPasswordAfterConfirmation('senhaNovaDaVitima1')
  assert.deepEqual(calls, [{ password: 'senhaNovaDaVitima1' }])
  // 'others' primeiro (revoga quem mais estiver logado com a senha antiga), 'local' depois
  // (exige login explícito com a senha nova a seguir) -- nunca a ordem inversa.
  assert.deepEqual(signOutCalls, [{ scope: 'others' }, { scope: 'local' }])
})

test('setPasswordAfterConfirmation: falha ao definir a senha propaga, sem encerrar sessão nenhuma', async () => {
  const signOutCalls = []
  globalThis.__updateUser = () => Promise.resolve({ error: new Error('network') })
  globalThis.__signOut = (args) => {
    signOutCalls.push(args)
    return Promise.resolve({ error: null })
  }
  await assert.rejects(mod.setPasswordAfterConfirmation('senhaNovaDaVitima1'), /network/)
  assert.deepEqual(signOutCalls, [])
})

test('setPasswordAfterConfirmation: senha definida com sucesso nunca é desfeita por uma falha ao encerrar sessões', async () => {
  globalThis.__updateUser = () => Promise.resolve({ error: null })
  // 'others' falha (best-effort, só warn) e 'local' também falha de verdade (sessão
  // ainda existente, ver signOutLocal) -- mesmo assim a função resolve.
  globalThis.__signOut = () => Promise.resolve({ error: new Error('network') })
  globalThis.__getSession = () => Promise.resolve({ data: { session: { access_token: 'x' } } })
  await quiet(() => mod.setPasswordAfterConfirmation('senhaNovaDaVitima1'))
})

test('endOtherSessions: encerra só as outras sessões (scope others), nunca esta', async () => {
  globalThis.__signOut = (args) => {
    calls.push(args)
    return Promise.resolve({ error: null })
  }
  await mod.endOtherSessions()
  assert.deepEqual(calls, [{ scope: 'others' }])
})

test('endOtherSessions: best-effort -- uma falha não lança (a senha já foi trocada)', async () => {
  globalThis.__signOut = () => Promise.resolve({ error: new Error('network') })
  await quiet(() => mod.endOtherSessions())
})
