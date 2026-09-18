import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'

const createCommunityWithCashCallable = httpsCallable(functions, 'createCommunityWithCash')

// Fase 5 (privilégios com EvoCash) -- requisitos e custo vêm sempre de
// economyConfig/current, nunca hardcoded aqui (mesmo padrão de
// cashPurchaseService.getCashPurchaseSettings): a Function revalida tudo de novo antes
// de cobrar, isto é só para a UI mostrar o que falta.
export async function getCreateCommunityPrivilege() {
  const snapshot = await getDoc(doc(db, 'economyConfig/current'))
  return snapshot.exists() ? snapshot.data()?.privileges?.createCommunity || null : null
}

// requestId gerado uma vez por tentativa e reenviado em qualquer retry -- mesma
// idempotência de requestCashPurchase (ver privilege-core.js: createCommunityIdFromRequest).
export async function createCommunityWithCash({ name, description, iconName, requestId }) {
  return (await createCommunityWithCashCallable({ name, description, iconName, requestId })).data
}
