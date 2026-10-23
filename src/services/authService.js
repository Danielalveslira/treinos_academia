import { supabase } from '../supabase/config'
import { disableOfflineAccess } from './offline/bootstrap'
import { isOfflineColdStartEnabled } from './offline/database'

export async function registerUser(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  // Com "Confirm email" ligado, data.session vem null: a conta existe no Auth mas sem
  // sessão até o código de confirmação ser verificado (ver confirmSignupOtp). O chamador
  // decide o que fazer com isso -- aqui só reportamos o que o GoTrue devolveu.
  return {
    user: { uid: data.user.id, email: data.user.email },
    hasSession: Boolean(data.session),
  }
}

// Confirmação de cadastro por código (OTP de 6 dígitos), não por link: um link de
// confirmação clicável pode ser consumido por scanners de segurança de e-mail
// corporativos antes do clique do usuário (ver comparação da Etapa 1). O código só é
// usado se alguém de fato o digitar no app.
export async function confirmSignupOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' })
  if (error) throw error
  return { uid: data.user.id, email: data.user.email }
}

// Sem equivalente exato do %DISPLAY_NAME% do template do Firebase (o template de
// e-mail do Supabase não tem essa variável) — mantido só para não quebrar a chamada em
// Register.jsx, gravando em user_metadata (não afeta nada mais no app hoje).
export async function setDisplayName(_user, displayName) {
  const { error } = await supabase.auth.updateUser({ data: { display_name: displayName } })
  if (error) throw error
}

// Reenvia o código de confirmação de cadastro. Usada tanto na etapa "digite o código"
// do próprio Register (sessão ainda não existe) quanto em ConfirmEmail.jsx (quem voltou
// depois de fechar a aba) -- por isso aceita o e-mail em vez de ler supabase.auth.getUser(),
// que não tem sessão para consultar antes da confirmação.
export async function sendVerificationEmail(email) {
  const { error } = await supabase.auth.resend({ type: 'signup', email })
  if (error) throw error
}

export async function loginUser(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

// Fluxo ÚNICO de logout. Chamadas concorrentes do MESMO escopo (duplo toque, duas abas do mesmo
// hook) compartilham a mesma requisição: signOut roda exatamente uma vez para elas. Chamadas de
// ESCOPO DIFERENTE só reaproveitam uma operação que já inclui o efeito pedido: local pode
// aguardar all, mas all precisa executar a revogação de outras sessões mesmo após um local.
//
// Escopos (auth-js 2.117):
//  - 'local' (PADRÃO do Evolutus, logoutUser): encerra só esta sessão; os outros aparelhos
//    seguem logados. É o "Sair da conta" de todos os pontos de saída.
//  - "Sair de todos os dispositivos" (logoutAllDevices): ação de segurança separada, sempre atrás
//    de confirmação explícita na UI, em DUAS etapas que o usuário vê como uma só:
//      1. signOut({ scope: 'others' }) revoga todas as outras sessões e MANTÉM a atual;
//      2. só se a 1 deu certo, o mesmo fluxo local de cima encerra este aparelho.
//    Se a etapa 1 falha, nada é encerrado aqui: o usuário continua logado e pode tentar de novo
//    (com 'global', uma falha de rede deixava este aparelho deslogado e os outros ativos).
//
// Se a revogação no servidor falha (sem rede, 5xx) num logout LOCAL, o SDK REMOVE a sessão local
// mesmo assim (emite SIGNED_OUT) e só devolve o erro. A sessão local nunca fica "presa": só é
// erro de verdade se ela continuar existindo. O resultado informa `revoked`:
//  - local + revoked:false -> sai deste aparelho; só o refresh token desta sessão segue válido
//    no servidor até expirar. Sem aviso (não muda nada para o usuário).
//
// O estado privado do frontend (caches, perfil, carteira, canais Realtime) é limpo pelo
// AuthContext quando o evento SIGNED_OUT chega; o redirecionamento para /login (replace) é do
// ProtectedRoute assim que `user` fica nulo.
// { scope: 'local' | 'all', promise } da operação em andamento, ou null. Nunca um booleano/promise
// solto: precisa do escopo para decidir se a próxima chamada pode reaproveitar ou tem que esperar.
let logoutInFlight = null

// Deduplica chamadas do MESMO escopo (retorna a mesma promessa). Um pedido 'local' pode aproveitar
// com segurança uma operação 'all' já em andamento -- 'all' revoga as outras sessões E encerra esta
// (um superconjunto estrito do que 'local' faria), então reaproveitar nunca relata menos do que
// realmente aconteceu; por isso NÃO troca o estado em andamento, para pedidos seguintes ainda
// encontrarem a MESMA operação 'all' (em vez de uma corrida reiniciar a cadeia a cada clique
// misturado -- ver 'múltiplos cliques' em logoutScope.test.js). Já um pedido 'all' NUNCA aproveita
// um 'local' em andamento (o inverso seria relatar outras sessões revogadas sem o terem sido):
// espera o 'local' terminar e roda a sua própria sequência completa de verdade.
function runExclusive(scope, task) {
  const previous = logoutInFlight
  if (previous?.scope === scope) return previous.promise
  if (scope === 'local' && previous?.scope === 'all') return previous.promise
  const start = previous ? previous.promise.catch(() => {}) : Promise.resolve()
  const promise = start.then(task).finally(() => {
    if (logoutInFlight?.promise === promise) logoutInFlight = null
  })
  logoutInFlight = { scope, promise }
  return promise
}

async function signOutLocal() {
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (!error) return { revoked: true }
  const { data } = await supabase.auth.getSession().catch(() => ({ data: null }))
  if (data?.session) throw error
  console.warn(
    '[Auth] logout (local): sessão local encerrada, revogação no servidor não confirmada:',
    error
  )
  return { revoked: false }
}

export function logoutUser() {
  return runExclusive('local', async () => {
    // LOGOUT EXPLÍCITO: antes de qualquer outra coisa, o aparelho deixa de poder abrir esta conta offline
    // (cold start). Sessão expirada/rede ruim NÃO passam por aqui -- só um logout pedido (ou forçado pelo
    // servidor, como exclusão de conta). A outbox não é tocada: o trabalho não sincronizado continua
    // guardado e volta a ser da sessão do mesmo usuário quando ele entrar de novo online.
    const disabled = await disableOfflineAccess()
    if (!disabled && isOfflineColdStartEnabled())
      throw new Error('Não foi possível concluir a saída neste aparelho. Tente novamente.')
    return signOutLocal()
  })
}

// Falha da etapa 1 carrega `logoutStep: 'others'`; falha DEPOIS dela (limpeza local deste
// aparelho) carrega `logoutStep: 'local-cleanup'` -- a UI precisa saber que as OUTRAS sessões já
// foram revogadas antes de mostrar a mensagem genérica de "não foi possível sair" (ver
// useLogout.logoutAllErrorMessage). `beforeLocalSignOut` roda DEPOIS de a etapa 1 dar certo e
// ANTES de encerrar esta sessão (ainda há JWT para chamar o backend): é o gancho da revogação de
// Web Push, que é best-effort -- uma falha dele nunca impede o logout e, se a etapa 1 falhar, ele
// nem chega a rodar.
export function logoutAllDevices({ beforeLocalSignOut } = {}) {
  return runExclusive('all', async () => {
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    if (error) {
      error.logoutStep = 'others'
      throw error
    }
    if (beforeLocalSignOut) {
      try {
        await beforeLocalSignOut()
      } catch (hookError) {
        console.warn('[Auth] pré-logout (best-effort) falhou:', hookError)
      }
    }
    const disabled = await disableOfflineAccess()
    if (!disabled && isOfflineColdStartEnabled()) {
      // As outras sessões JÁ foram revogadas (confirmado): só a saída DESTE aparelho não concluiu.
      const failure = new Error('Não foi possível concluir a saída neste aparelho. Tente novamente.')
      failure.logoutStep = 'local-cleanup'
      throw failure
    }
    // As outras sessões foram revogadas (confirmado); o que sobra incerto é só o token deste
    // aparelho, que já saiu (ver signOutLocal: revoked:false não é erro, é só confirmação
    // pendente) -- o resultado reflete o que realmente aconteceu na etapa local, nunca um
    // `revoked:true` fixo independente do que signOutLocal confirmou.
    try {
      return await signOutLocal()
    } catch (error) {
      error.logoutStep = 'local-cleanup'
      throw error
    }
  })
}

// Sem redirectTo: o template de recovery (supabase/templates/recovery.html) monta o
// link com {{ .SiteURL }} direto para /redefinir-senha, que troca o token_hash por
// sessão no cliente (ver ResetPassword.jsx) -- não depende do allow-list de
// additional_redirect_urls, que só vale para o .ConfirmationURL/redirectTo padrão.
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error) throw error
}

// Troca o token_hash do link de recuperação por uma sessão autenticada. Só então
// updateUser({ password }) é permitido -- é essa sessão temporária, não a senha antiga,
// que autoriza a troca.
export async function verifyRecoveryToken(tokenHash) {
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
  if (error) throw error
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

// Chamada só depois de confirmSignupOtp estabelecer sessão (ver confirmSignupAndSyncPassword):
// alinha a senha da conta com o que está no formulário de cadastro NESTE momento. Necessária
// contra um cenário de pre-account hijacking confirmado em teste local contra o GoTrue: um
// atacante que sabe o e-mail da vítima pode fazer signUp primeiro com uma senha própria; se a
// vítima então se cadastrar normalmente com o MESMO e-mail (sem saber que já existe uma
// tentativa pendente), o GoTrue confirma a conta da vítima mas MANTÉM a senha do atacante --
// um segundo signUp para um e-mail ainda não confirmado nunca atualiza a senha, só reenvia o
// código. LANÇA em caso de falha (ao contrário de endOtherSessions/logoutUser best-effort
// deste arquivo): o chamador DEVE falhar de forma fechada, nunca conceder acesso sem
// confirmar que a senha da conta é a que esta pessoa digitou agora (ver
// confirmSignupAndSyncPassword). Testado também com secure_password_change=true: a sessão
// recém-criada pelo verifyOtp já conta como "logado recentemente", sem bloqueio extra.
export async function syncSignupPassword(password) {
  if (!password) throw new Error('MISSING_PASSWORD')
  try {
    await updatePassword(password)
  } catch (err) {
    // same_password (confirmado em produção e reproduzido localmente): acontece no
    // cadastro NORMAL, sem nada de ataque -- a senha do formulário já É a senha que o
    // signUp acabou de gravar, então updateUser rejeita por ser igual à atual. Isso
    // PROVA que é a senha certa (não a de um atacante), nunca o contrário -- tratado
    // como sucesso. Qualquer outro erro continua fail-closed, sem exceção.
    if (err?.code === 'same_password') return
    throw err
  }
}

// Orquestra a confirmação de cadastro com o failsafe de senha acima: confirma o código e só
// então alinha a senha. Se a senha não puder ser confirmada, encerra a sessão recém-criada
// (nunca deixa uma conta logada com uma senha não comprovada por quem está confirmando) e
// propaga um erro com code: 'PASSWORD_SYNC_FAILED' para o chamador decidir a UI (ver
// Register.jsx) -- nunca a senha em si, nem aqui nem em nenhum log.
export async function confirmSignupAndSyncPassword(email, token, password) {
  await confirmSignupOtp(email, token)
  try {
    await syncSignupPassword(password)
  } catch (err) {
    console.error('[Auth] syncSignupPassword falhou após confirmar -- encerrando sessão:', err)
    await logoutUser().catch(() => {})
    const failure = new Error('PASSWORD_SYNC_FAILED')
    failure.code = 'PASSWORD_SYNC_FAILED'
    throw failure
  }
}

// Usada por ConfirmEmail.jsx: ali não há NENHUMA senha conhecida (quem confirma pode ser a
// vítima do mesmo cenário de hijacking acima, chegando por um caminho sem o formulário de
// cadastro em memória). Por isso exige definir uma senha nova antes de qualquer acesso --
// nunca reaproveita o que já estava na conta. endOtherSessions é best-effort (revoga sessões
// de quem tiver cadastrado a conta antes, inclusive um possível atacante já logado);
// logoutUser também não bloqueia o retorno -- o objetivo é sempre exigir um login explícito
// com a senha nova a seguir, mas uma falha ao encerrar ESTA sessão não deve impedir a pessoa
// de saber que a senha já foi trocada com sucesso.
export async function setPasswordAfterConfirmation(password) {
  await updatePassword(password)
  await endOtherSessions()
  await logoutUser().catch(() => {})
}

// Chamado depois de uma redefinição de senha bem-sucedida: revoga qualquer sessão que
// alguém mais possa ter aberto com a senha antiga, sem encerrar esta (a sessão criada
// agora pela própria recuperação). Best-effort de propósito -- diferente de
// logoutAllDevices, uma falha aqui não desfaz a troca de senha, que já aconteceu.
export async function endOtherSessions() {
  const { error } = await supabase.auth.signOut({ scope: 'others' })
  if (error) console.warn('[Auth] endOtherSessions:', error)
}
