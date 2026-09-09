import { httpsCallable } from 'firebase/functions'
import { doc, getDoc, writeBatch } from 'firebase/firestore'
import { db, functions, auth } from '../firebase/config'
import { DEFAULT_BILLING_CONFIG } from '../utils/billing'
import { createConfigCache } from '../utils/configCache'
import { validateBillingConfig } from '../utils/billingConfig'

const listeners = new Set()
const cache = createConfigCache(async (uid) => {
  const [plans, billing] = await Promise.all([
    getDoc(doc(db, 'appConfig', 'plans')),
    uid ? getDoc(doc(db, 'appConfig', 'billing')) : null,
  ])
  return { ...DEFAULT_BILLING_CONFIG, ...(billing?.data() || {}), ...(plans.data() || {}) }
})

export function subscribeBillingConfig(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getBillingConfig() {
  return cache.get(auth.currentUser?.uid || '')
}

export function invalidateBillingConfig() {
  cache.clear()
  listeners.forEach((listener) => listener())
}

export async function saveBillingConfig(config) {
  const error = validateBillingConfig(config)
  if (error) throw new Error(error)
  const {
    plans,
    pixKey,
    pixKeyType,
    receiverName,
    whatsapp,
    trialDays,
    warningDaysBeforeDue,
    graceBusinessDays,
  } = config
  const batch = writeBatch(db)
  batch.set(doc(db, 'appConfig', 'plans'), { plans })
  batch.set(doc(db, 'appConfig', 'billing'), {
    pixKey,
    pixKeyType,
    receiverName,
    whatsapp,
    trialDays,
    warningDaysBeforeDue,
    graceBusinessDays,
  })
  await batch.commit()
  invalidateBillingConfig()
}

export function initializeTrial() {
  return httpsCallable(functions, 'initializeTrial')()
}

export async function confirmPayment(userId, planId) {
  // Keep the operation across dialog closure/reload when the response is lost.
  const key = `payment:${auth.currentUser.uid}:${userId}:${planId}`
  let operationId = sessionStorage.getItem(key)
  if (!operationId) {
    operationId = crypto.randomUUID()
    sessionStorage.setItem(key, operationId)
  }
  const result = (await httpsCallable(functions, 'confirmPayment')({ userId, planId, operationId }))
    .data
  sessionStorage.removeItem(key)
  return result
}

export async function setAccountStatus(userId, disabled, reason = '') {
  return (await httpsCallable(functions, 'setAccountStatus')({ userId, disabled, reason })).data
}

export async function deleteAccountPermanently(userId, confirmation) {
  return (await httpsCallable(functions, 'deleteAccountPermanently')({ userId, confirmation })).data
}

// Via Cloud Function (não leitura direta do Firestore) porque o e-mail só existe no
// Authentication — precisa do Admin SDK para juntar os dois no painel admin.
export async function listAccountsPage(filters = {}) {
  return (await httpsCallable(functions, 'listAccountsForAdmin')(filters)).data
}

export async function listDeletionJobs() {
  return (await httpsCallable(functions, 'listDeletionJobs')()).data.jobs
}

// TEMPORARY: drives the one-time migration in docs/admin-maintenance.md. Remove
// alongside the runAdminMigration function once it is applied in production.
export async function runAdminMigration(apply = false) {
  return (await httpsCallable(functions, 'runAdminMigration')({ apply })).data
}
