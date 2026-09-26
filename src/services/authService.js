import { supabase } from '../supabase/config'

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

export async function logoutUser() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
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
