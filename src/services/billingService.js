import { httpsCallable } from 'firebase/functions'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db, functions } from '../firebase/config'
import { DEFAULT_BILLING_CONFIG } from '../utils/billing'

// Config quase nunca muda e é lida por vários componentes independentes na mesma sessão
// (banner de assinatura, gate de acesso, página de pagamento, painel admin) — sem esse
// cache em memória, cada um dispararia sua própria leitura do mesmo documento.
let cachedConfig = null
let pendingFetch = null

// Split em dois documentos por causa das regras: appConfig/plans é público (a página de
// Planos é acessível deslogado), appConfig/billing (chave PIX, WhatsApp, nome do
// recebedor) exige login. Os componentes continuam recebendo um único objeto — só aqui
// dentro que existe a junção dos dois.
export async function getBillingConfig() {
  if (cachedConfig) return cachedConfig
  if (!pendingFetch) {
    pendingFetch = (async () => {
      const plansSnap = await getDoc(doc(db, 'appConfig', 'plans'))
      let billingData = {}
      try {
        const billingSnap = await getDoc(doc(db, 'appConfig', 'billing'))
        billingData = billingSnap.exists() ? billingSnap.data() : {}
      } catch {
        // Visitante deslogado (ex: página de Planos): sem acesso a PIX/WhatsApp,
        // só aos planos públicos — comportamento esperado, não é erro.
      }
      cachedConfig = {
        ...DEFAULT_BILLING_CONFIG,
        ...billingData,
        ...(plansSnap.exists() ? plansSnap.data() : {}),
      }
      pendingFetch = null
      return cachedConfig
    })()
  }
  return pendingFetch
}

export async function saveBillingConfig(config) {
  const { plans, ...billingFields } = config
  await Promise.all([
    setDoc(doc(db, 'appConfig', 'plans'), { plans }, { merge: true }),
    setDoc(doc(db, 'appConfig', 'billing'), billingFields, { merge: true }),
  ])
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
