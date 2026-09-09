import { httpsCallable } from 'firebase/functions'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db, functions } from '../firebase/config'
import { DEFAULT_BILLING_CONFIG } from '../utils/billing'

// Config quase nunca muda e é lida por vários componentes independentes na mesma sessão
// (banner de assinatura, gate de acesso, página de pagamento, painel admin) — sem esse
// cache em memória, cada um dispararia sua própria leitura do mesmo documento.
let cachedConfig = null
let pendingFetch = null

export async function getBillingConfig() {
  if (cachedConfig) return cachedConfig
  if (!pendingFetch) {
    pendingFetch = getDoc(doc(db, 'appConfig', 'billing')).then((snapshot) => {
      cachedConfig = snapshot.exists()
        ? { ...DEFAULT_BILLING_CONFIG, ...snapshot.data() }
        : DEFAULT_BILLING_CONFIG
      pendingFetch = null
      return cachedConfig
    })
  }
  return pendingFetch
}

export async function saveBillingConfig(config) {
  await setDoc(doc(db, 'appConfig', 'billing'), config, { merge: true })
  cachedConfig = { ...DEFAULT_BILLING_CONFIG, ...config }
}

export function initializeTrial() {
  return httpsCallable(functions, 'initializeTrial')()
}

export async function confirmPayment(userId, planId) {
  return (await httpsCallable(functions, 'confirmPayment')({ userId, planId })).data
}

export async function setAccountStatus(userId, disabled, reason = '') {
  return (await httpsCallable(functions, 'setAccountStatus')({ userId, disabled, reason })).data
}

export async function deleteAccountPermanently(userId, confirmation) {
  return (await httpsCallable(functions, 'deleteAccountPermanently')({ userId, confirmation })).data
}

// Via Cloud Function (não leitura direta do Firestore) porque o e-mail só existe no
// Authentication — precisa do Admin SDK para juntar os dois no painel admin.
export async function listAllAccounts() {
  return (await httpsCallable(functions, 'listAccountsForAdmin')()).data.accounts
}
