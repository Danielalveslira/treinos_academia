import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/config'

// Administração de chaves PIX (aba "Configuração PIX" de /admin/compras-evocash).
// privatePaymentConfig/pix nunca é lido/escrito direto do client SDK (ver
// firestore.rules: allow read, write: if false) -- todo o CRUD passa só por estas
// callables, protegidas por superadmin no backend (ver pix-payment-admin-service.js).
const listPixPaymentMethodsCallable = httpsCallable(functions, 'listPixPaymentMethods')
const savePixPaymentMethodCallable = httpsCallable(functions, 'savePixPaymentMethod')
const setActivePixPaymentMethodCallable = httpsCallable(functions, 'setActivePixPaymentMethod')
const deletePixPaymentMethodCallable = httpsCallable(functions, 'deletePixPaymentMethod')
const setPixPaymentsEnabledCallable = httpsCallable(functions, 'setPixPaymentsEnabled')

export async function listPixPaymentMethods() {
  return (await listPixPaymentMethodsCallable()).data
}

export async function savePixPaymentMethod({ methodId = null, label, key, keyType, recipientName }) {
  return (await savePixPaymentMethodCallable({ methodId, label, key, keyType, recipientName })).data
}

export async function setActivePixPaymentMethod(methodId) {
  return (await setActivePixPaymentMethodCallable({ methodId })).data
}

export async function deletePixPaymentMethod(methodId) {
  return (await deletePixPaymentMethodCallable({ methodId })).data
}

export async function setPixPaymentsEnabled(enabled) {
  return (await setPixPaymentsEnabledCallable({ enabled })).data
}
