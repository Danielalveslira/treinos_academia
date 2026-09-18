import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'

const requestCashPurchaseCallable = httpsCallable(functions, 'requestCashPurchase')
const confirmCashPurchaseCallable = httpsCallable(functions, 'confirmCashPurchase')
const cancelCashPurchaseCallable = httpsCallable(functions, 'cancelCashPurchase')

const PAGE_SIZE = 25

// Preço/quantidade sempre vêm daqui (economyConfig/current), nunca de um valor
// digitado -- o cliente só manda o packageId escolhido (ver requestCashPurchase). Lido
// direto pelo client SDK (Rules já liberam leitura de economyConfig a qualquer
// signed-in), sem callable própria -- é só exibição, requestCashPurchase revalida tudo
// de novo no servidor antes de creditar qualquer coisa. pixKey é um campo de exibição
// puro (a Function nunca lê nem valida isto) -- configurado manualmente no mesmo
// documento, ausente até alguém cadastrar.
export async function getCashPurchaseSettings() {
  const snapshot = await getDoc(doc(db, 'economyConfig/current'))
  const data = snapshot.exists() ? snapshot.data() : {}
  const packages = Object.entries(data?.cashPackages || {})
    .filter(([, pkg]) => pkg?.active === true)
    .map(([packageId, pkg]) => ({ packageId, ...pkg }))
  return { packages, pixKey: data?.pixKey || null }
}

// requestId gerado UMA VEZ por tentativa de compra e reenviado em qualquer retry --
// isso é o que torna requestCashPurchase idempotente (ver cash-purchase-core.js:
// cashPurchaseIdFromRequest). Quem chama esta função decide quando gerar um requestId
// novo (uma nova intenção de compra) vs. reenviar o mesmo (retry da mesma intenção).
export async function requestCashPurchase({ packageId, requestId }) {
  return (await requestCashPurchaseCallable({ packageId, requestId })).data
}

export async function confirmCashPurchase(purchaseId, adminNote) {
  return (await confirmCashPurchaseCallable({ purchaseId, adminNote })).data
}

export async function cancelCashPurchase(purchaseId, reason) {
  return (await cancelCashPurchaseCallable({ purchaseId, reason })).data
}

export async function listMyCashPurchasesPage(userId, { cursor = null } = {}) {
  const filters = [where('userId', '==', userId), orderBy('createdAt', 'desc')]
  if (cursor) filters.push(startAfter(cursor))
  const result = await getDocs(query(collection(db, 'cashPurchases'), ...filters, limit(PAGE_SIZE)))
  return {
    items: result.docs.map((item) => ({ ...item.data(), id: item.id })),
    nextCursor: result.size === PAGE_SIZE ? result.docs.at(-1) : null,
  }
}

export async function listCashPurchasesForAdminPage({ status = '', cursor = null } = {}) {
  const filters = []
  if (status) filters.push(where('status', '==', status))
  filters.push(orderBy('createdAt', 'desc'))
  if (cursor) filters.push(startAfter(cursor))
  const result = await getDocs(query(collection(db, 'cashPurchases'), ...filters, limit(PAGE_SIZE)))
  return {
    items: result.docs.map((item) => ({ ...item.data(), id: item.id })),
    nextCursor: result.size === PAGE_SIZE ? result.docs.at(-1) : null,
  }
}
