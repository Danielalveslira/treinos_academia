import { supabase } from '../supabase/config'
import { disableOfflineAccess } from './offline/bootstrap'
import { isOfflineColdStartEnabled } from './offline/database'

export async function registerUser(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return { user: { uid: data.user.id, email: data.user.email } }
}

// NOTA DE COMPATIBILIDADE: no Firebase, o cadastro loga na hora e a verificação de
// e-mail é só um gate de acesso (emailVerifiedOk nas rules) — o usuário navega logado,
// só vendo telas bloqueadas até clicar no link. No Supabase, "Confirm email" ligado
// impede a sessão de existir até a confirmação (sem sessão pra sequer mostrar um
// gate); com autoconfirm ligado (como está hoje, necessário pro cadastro completar
// sem travar — ver conversa anterior), email_confirmed_at já vem preenchido na hora,
// então esta função e has_app_access() não bloqueiam ninguém de verdade ainda. Fica
// como TODO: replicar o gate completo exige decidir explicitamente o trade-off
// (desativar autoconfirm e perder o "loga na hora", ou um mecanismo de verificação
// paralelo próprio) — não decidi isso sozinho.
// Sem equivalente exato do %DISPLAY_NAME% do template do Firebase (o template de
// e-mail do Supabase não tem essa variável) — mantido só para não quebrar a chamada em
// Register.jsx, gravando em user_metadata (não afeta nada mais no app hoje).
export async function setDisplayName(_user, displayName) {
  const { error } = await supabase.auth.updateUser({ data: { display_name: displayName } })
  if (error) throw error
}

export async function sendVerificationEmail() {
  const { data } = await supabase.auth.getUser()
  if (!data.user?.email) return
  const { error } = await supabase.auth.resend({ type: 'signup', email: data.user.email })
  if (error) throw error
}

export async function refreshEmailVerified() {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return !!data.user?.email_confirmed_at
}

export async function loginUser(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

// Fluxo ÚNICO de logout. Chamadas concorrentes (duplo toque, menu + gate, logout forçado do
// AuthContext) compartilham a mesma requisição: signOut roda exatamente uma vez. Com um logout
// em andamento, qualquer outro pedido (inclusive de escopo diferente) recebe a mesma promessa --
// os botões ficam travados juntos (useLogout), então isso só protege contra corrida.
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
let logoutInFlight = null

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

function singleFlight(task) {
  if (!logoutInFlight) {
    logoutInFlight = task().finally(() => {
      logoutInFlight = null
    })
  }
  return logoutInFlight
}

export function logoutUser() {
  return singleFlight(async () => {
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

// Falha da etapa 1 carrega `logoutStep: 'others'` para a UI mostrar a mensagem certa.
// `beforeLocalSignOut` roda DEPOIS de a etapa 1 dar certo e ANTES de encerrar esta sessão (ainda
// há JWT para chamar o backend): é o gancho da revogação de Web Push, que é best-effort -- uma
// falha dele nunca impede o logout e, se a etapa 1 falhar, ele nem chega a rodar.
export function logoutAllDevices({ beforeLocalSignOut } = {}) {
  return singleFlight(async () => {
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
    if (!disabled && isOfflineColdStartEnabled())
      throw new Error('Não foi possível concluir a saída neste aparelho. Tente novamente.') // logout explícito: também deste aparelho
    await signOutLocal()
    // As outras sessões foram revogadas (confirmado); o que sobra incerto é só o token deste
    // aparelho, que já saiu.
    return { revoked: true }
  })
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error) throw error
}

// Substitui credential.user.delete() do Firebase (que permitia a própria conta recém-criada
// se autoexcluir do lado do cliente) — o SDK do Supabase não expõe esse método, então isso
// é feito por uma RPC que só apaga o próprio auth.users (cascateando para users/publicProfiles
// /usernames). Usado só no rollback de cadastro (ver Register.jsx).
export async function deleteCurrentAccount() {
  const { error } = await supabase.rpc('delete_own_account')
  if (error) throw error
}
