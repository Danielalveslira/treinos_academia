import { httpsCallable } from 'firebase/functions'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db, functions } from '../firebase/config'
import { DEFAULT_BILLING_CONFIG } from '../utils/billing'

export async function getBillingConfig() {
  const snapshot = await getDoc(doc(db, 'appConfig', 'billing'))
  return snapshot.exists()
    ? { ...DEFAULT_BILLING_CONFIG, ...snapshot.data() }
    : DEFAULT_BILLING_CONFIG
}

export function saveBillingConfig(config) {
  return setDoc(doc(db, 'appConfig', 'billing'), config, { merge: true })
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
