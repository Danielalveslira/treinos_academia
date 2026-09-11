import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
} from 'firebase/auth'
import { auth } from '../firebase/config'

export function registerUser(email, password) {
  return createUserWithEmailAndPassword(auth, email, password)
}

export function sendVerificationEmail(user) {
  return sendEmailVerification(user)
}

// O template de verificação de e-mail do Firebase usa %DISPLAY_NAME% (ver Console >
// Authentication > Templates) — sem isso, chega em branco ("Olá ,") pra todo mundo,
// já que o cadastro nunca preenchia esse campo do Authentication.
export function setDisplayName(user, displayName) {
  return updateProfile(user, { displayName })
}

// user.emailVerified só reflete o que o SDK já tinha em memória (do último login/token) —
// depois que o usuário clica no link, nada nesta aba avisa isso sozinho. reload() busca o
// estado atual do próprio Firebase Auth e atualiza o objeto `user` (inclusive
// emailVerified) in place; é isso que EmailVerificationGate chama tanto ao montar quanto
// no botão "Já verifiquei".
//
// reload() sozinho NÃO é suficiente: ele atualiza o objeto `user` local, mas o token de
// ID que o Firestore/Storage/Functions realmente anexam em cada requisição só é
// reemitido quando expira sozinho (até 1h) ou quando alguém força — email_verified é uma
// claim gravada DENTRO desse token, não relida a cada chamada. Sem o getIdToken(true)
// abaixo, o app mostra o conteúdo liberado (o objeto local diz emailVerified: true) mas
// toda consulta ao Firestore continua sendo negada pelas regras, que leem o token antigo,
// não o objeto local — foi exatamente esse o bug relatado (permissão negada mesmo depois
// de verificar).
export async function refreshEmailVerified(user) {
  await user.reload()
  if (user.emailVerified) await user.getIdToken(true)
  return user.emailVerified
}

export function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
}

export function logoutUser() {
  return signOut(auth)
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email)
}
