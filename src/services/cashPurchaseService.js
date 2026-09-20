import {
  collection,
  doc,
  documentId,
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
// de novo no servidor antes de creditar qualquer coisa. pixPayment é um campo de
// exibição (a Function só valida SE ele é aceitável -- enabled/key/keyType/
// recipientName -- antes de permitir a criação do pedido; nunca lê o valor pra calcular
// preço/quantidade), configurado manualmente no mesmo documento, ausente até alguém
// cadastrar.
export async function getCashPurchaseSettings() {
  const snapshot = await getDoc(doc(db, 'economyConfig/current'))
  const data = snapshot.exists() ? snapshot.data() : {}
  const packages = Object.entries(data?.cashPackages || {})
    .filter(([, pkg]) => pkg?.active === true)
    .map(([packageId, pkg]) => ({ packageId, ...pkg }))
  return { packages, pixPayment: data?.pixPayment || null }
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

const USER_LOOKUP_CHUNK_SIZE = 30 // teto do operador "in" do Firestore

// Resolve o username de vários compradores de uma vez só -- nunca uma leitura por card
// na lista do admin (evita N+1). Mesma técnica de documentId()+'in' já usada em
// economyService.js (fetchMyVotesForStatuses): users/{uid} já libera isSuperAdmin() ler
// qualquer perfil (ver firestore.rules), então isto funciona direto do client SDK, sem
// precisar de uma callable nova só pra isso.
export async function resolveUsernamesByIds(userIds) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean)
  const usernameById = {}
  for (let i = 0; i < uniqueIds.length; i += USER_LOOKUP_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + USER_LOOKUP_CHUNK_SIZE)
    const refs = chunk.map((id) => doc(db, 'users', id))
    const snapshot = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', refs)))
    for (const item of snapshot.docs) {
      usernameById[item.id] = item.data()?.username || null
    }
  }
  return usernameById
}
