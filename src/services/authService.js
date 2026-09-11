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
export async function refreshEmailVerified(user) {
  await user.reload()
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
