import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'

const createPromotionCallable = httpsCallable(functions, 'createPromotion')
const cancelPromotionCallable = httpsCallable(functions, 'cancelPromotion')
const recordPromotionEventCallable = httpsCallable(functions, 'recordPromotionEvent')

const FEATURED_LIMIT = 6
const MY_PROMOTIONS_LIMIT = 50
const ADMIN_LIST_LIMIT = 200

// Fase 6 (promoções pagas com EvoCash) -- preço/duração sempre vêm daqui
// (economyConfig/current.promotionPackages), nunca digitados pelo cliente; o servidor
// revalida tudo de novo antes de debitar (ver promotion-service.js). Separado de
// cashPackages (comprar EvoCash) e de privileges (um custo fixo só) -- este é um
// catálogo pequeno de pacotes, igual em espírito a cashPackages.
export async function getPromotionPackages(targetType) {
  const snapshot = await getDoc(doc(db, 'economyConfig/current'))
  const data = snapshot.exists() ? snapshot.data() : {}
  return Object.entries(data?.promotionPackages || {})
    .filter(([, pkg]) => pkg?.active === true && (!targetType || pkg?.targetType === targetType))
    .map(([packageId, pkg]) => ({ packageId, ...pkg }))
}

// requestId gerado uma vez pelo chamador e reenviado em qualquer retry -- mesmo
// mecanismo de idempotência de requestCashPurchase/createCommunityWithCash (ver
// resolveRequestId em utils/cashPurchaseFlow.js, reaproveitado pelo componente).
export async function createPromotion({ targetType, targetId, packageId, requestId }) {
  return (await createPromotionCallable({ targetType, targetId, packageId, requestId })).data
}

export async function cancelPromotion({ promotionId, reason }) {
  return (await cancelPromotionCallable({ promotionId, reason })).data
}

// "Fogo e esquece" da perspectiva da UI -- uma falha aqui nunca deveria impedir a
// navegação/exibição do conteúdo (métrica informativa, nunca base de cobrança).
// targetType/targetId vêm do próprio card que disparou o clique (o mesmo de onde a UI
// leu activePromotionId) -- o servidor revalida que promotionId realmente corresponde
// a este alvo e ainda está ativo antes de incrementar (nunca confia só no ID).
export async function recordPromotionClick({ targetType, targetId, promotionId }) {
  return (await recordPromotionEventCallable({ targetType, targetId, promotionId, type: 'click' })).data
}

// Nunca lê promotions/{id} para decidir o que destacar -- só os campos denormalizados
// no próprio alvo (promoted/promotedUntil), filtrados no servidor (nunca limit()
// antes de tirar os expirados: ver auditoria da Fase 6). Um post/comunidade cuja janela
// já passou simplesmente não bate mais o filtro `promotedUntil > agora`.
export async function listFeaturedStatusesForCommunity(communityId) {
  const snapshot = await getDocs(
    query(
      collection(db, 'statuses'),
      where('communityId', '==', communityId),
      where('promoted', '==', true),
      where('promotedUntil', '>', Timestamp.now()),
      orderBy('promotedUntil', 'asc'),
      limit(FEATURED_LIMIT)
    )
  )
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

export async function listFeaturedCommunities() {
  const snapshot = await getDocs(
    query(
      collection(db, 'communities'),
      where('promoted', '==', true),
      where('promotedUntil', '>', Timestamp.now()),
      orderBy('promotedUntil', 'asc'),
      limit(FEATURED_LIMIT)
    )
  )
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

// "Minhas promoções" -- histórico do próprio usuário (ativa, cancelada ou com o alvo
// removido). Sem filtro de status: "expirada" é só um rótulo calculado na exibição
// (mesmo raciocínio de isExpired em AdminSponsoredAds.jsx), nunca um valor gravado.
export async function listMyPromotions(uid) {
  const snapshot = await getDocs(
    query(
      collection(db, 'promotions'),
      where('ownerId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(MY_PROMOTIONS_LIMIT)
    )
  )
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

// Só superadmin consegue de fato ler isto (ver firestore.rules) -- usado pelo painel
// admin de moderação de promoções, NUNCA o painel de sponsoredAds (sistemas separados).
export async function listAllPromotionsForAdmin() {
  const snapshot = await getDocs(
    query(collection(db, 'promotions'), orderBy('createdAt', 'desc'), limit(ADMIN_LIST_LIMIT))
  )
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}
