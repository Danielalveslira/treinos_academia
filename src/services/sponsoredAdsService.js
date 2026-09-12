import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  MAX_ACTIVE_ADS_PER_COMMUNITY,
  SponsoredAdCapError,
  MAX_ACTIVE_GLOBAL_ADS,
  SponsoredAdGlobalCapError,
} from '../utils/validators'

// Um anúncio só aparece nas comunidades listadas em communityIds — NUNCA em todas por
// padrão. A ausência de uma comunidade nessa lista não é um bug a corrigir; é o
// comportamento esperado. firestore.rules reforça essa mesma filtragem no servidor (não
// só confia neste arquivo), então mudar esse comportamento exige mudar os dois lugares.

// Teto defensivo de listagem administrativa, mesmo padrão de MAX_COMMUNITIES
// (communitiesService.js) e MAX_MEMBERSHIPS (communityMembersService.js).
const MAX_LIST = 200

function sponsoredAdsRef() {
  return collection(db, 'sponsoredAds')
}

function toDoc(d) {
  return { id: d.id, ...d.data() }
}

function toTimestampOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date)
}

// Uso administrativo: todos os anúncios, ativos ou não, pra tela de gestão.
export async function listAllSponsoredAds() {
  const q = query(sponsoredAdsRef(), orderBy('createdAt', 'desc'), limit(MAX_LIST))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(toDoc)
}

// Consulta usada pelas telas de comunidade (card no feed / banner rotativo): só o filtro
// que o Firestore consegue aplicar no servidor (array-contains). expiresAt (opcional —
// uma inequality excluiria documentos sem o campo) e displayMode (Firestore só permite
// um array-contains por consulta) são filtrados no client logo depois deste fetch.
export async function listSponsoredAdsForCommunity(communityId) {
  const q = query(sponsoredAdsRef(), where('communityIds', 'array-contains', communityId))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(toDoc)
}

// Consulta usada pelo banner rotativo da Home: anúncios globais, sem relação com
// comunidades do usuário. Mesmo padrão de listSponsoredAdsForCommunity — expiresAt e
// displayMode ficam de fora do filtro do servidor (ver comentário acima) e são
// filtrados no client (ver useGlobalSponsoredAds.js).
export async function listGlobalSponsoredAds() {
  const q = query(sponsoredAdsRef(), where('isGlobal', '==', true))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(toDoc)
}

// Não filtra por expiresAt de propósito: um anúncio vencido que ninguém excluiu ainda
// continua "ocupando vaga" no teto — isso empurra o admin a limpar o que não vale mais,
// em vez de deixar anúncios vencidos se acumularem sem limite.
async function countAdsTargeting(communityId, excludeAdId) {
  const q = query(sponsoredAdsRef(), where('communityIds', 'array-contains', communityId))
  const snapshot = await getDocs(q)
  return snapshot.docs.filter((d) => d.id !== excludeAdId).length
}

// Mesmo raciocínio de countAdsTargeting, mas para o teto global (MAX_ACTIVE_GLOBAL_ADS)
// — não filtra por expiresAt de propósito, pelo mesmo motivo.
async function countActiveGlobalAds(excludeAdId) {
  const q = query(sponsoredAdsRef(), where('isGlobal', '==', true))
  const snapshot = await getDocs(q)
  return snapshot.docs.filter((d) => d.id !== excludeAdId).length
}

// Chamado por createSponsoredAd/updateSponsoredAd (garantia mesmo se a tela não checar
// antes) e pensado pra também ser chamado direto pelo formulário admin, assim que ele
// existir, pra dar um erro inline em vez de só estourar no momento de salvar. Lança
// SponsoredAdCapError na primeira comunidade que já está no teto.
//
// Duas lacunas conhecidas e aceitas de propósito, não descuido:
// 1. Não é atômico: é uma leitura (contagem) seguida de uma escrita separada, não uma
//    transação. O SDK do Firestore para client só permite transaction.get() em uma
//    DocumentReference específica, nunca em uma Query — array-contains não entra numa
//    transação. Torná-lo atômico exigiria um documento contador por comunidade
//    (FieldValue.increment dentro de runTransaction), mudando o modelo de dados só pra
//    isso. Duas criações simultâneas para a mesma comunidade poderiam furar o teto por
//    1-2 unidades; mesmo raciocínio de bumpMemberCount (community-members-service.js):
//    aceitável porque autocorrige na próxima tentativa, e o cenário exige dois
//    superadmins (ou duplo clique) mirando a mesma comunidade no mesmo instante.
// 2. Só existe aqui, não em firestore.rules — regras também não conseguem rodar uma
//    contagem. Um client que chamasse addDoc direto (pulando este arquivo) ignoraria o
//    teto. Aceitável porque só superadmin escreve em sponsoredAds (mesma superfície de
//    confiança já usada pra não travar isso em regra).
export async function assertUnderActiveAdsCap(communityIds, { excludeAdId } = {}) {
  for (const communityId of communityIds) {
    const count = await countAdsTargeting(communityId, excludeAdId)
    if (count >= MAX_ACTIVE_ADS_PER_COMMUNITY) {
      throw new SponsoredAdCapError(communityId)
    }
  }
}

// Mesma decisão consciente de assertUnderActiveAdsCap acima, não uma trava diferente:
// leitura (contagem) seguida de escrita separada, sem transação — dois superadmins (ou
// um duplo clique) marcando "Exibir na Home" ao mesmo tempo podem cada um ler a
// contagem antes do outro terminar de escrever, furando MAX_ACTIVE_GLOBAL_ADS por 1-2
// unidades. Aceitável pelo mesmo motivo: autocorrige na próxima tentativa de criar ou
// editar um anúncio global, e o cenário exige dois admins agindo no mesmo instante. Só
// existe aqui, não em firestore.rules (regras não conseguem rodar uma contagem) — um
// client que chamasse addDoc direto, pulando este arquivo, ignoraria o teto (mas ainda
// cai na validação de forma de isValidSponsoredAd, que independe deste teto).
export async function assertUnderActiveGlobalAdsCap(isGlobal, { excludeAdId } = {}) {
  if (!isGlobal) return
  const count = await countActiveGlobalAds(excludeAdId)
  if (count >= MAX_ACTIVE_GLOBAL_ADS) {
    throw new SponsoredAdGlobalCapError()
  }
}

function sponsoredAdFields(ad) {
  const hasCta = Boolean(ad.ctaLabel?.trim())
  return {
    partnerName: ad.partnerName.trim(),
    title: ad.title.trim(),
    description: ad.description?.trim() || '',
    imageUrl: ad.imageUrl?.trim() || null,
    ctaLabel: hasCta ? ad.ctaLabel.trim() : null,
    ctaType: hasCta ? ad.ctaType : null,
    ctaTarget: hasCta ? ad.ctaTarget.trim() : null,
    expiresAt: toTimestampOrNull(ad.expiresAt),
    communityIds: ad.communityIds,
    isGlobal: Boolean(ad.isGlobal),
    displayMode: ad.displayMode,
  }
}

export async function createSponsoredAd(userId, ad) {
  await assertUnderActiveAdsCap(ad.communityIds)
  await assertUnderActiveGlobalAdsCap(ad.isGlobal)
  return addDoc(sponsoredAdsRef(), {
    ...sponsoredAdFields(ad),
    createdBy: userId,
    createdAt: serverTimestamp(),
  })
}

export async function updateSponsoredAd(adId, ad) {
  await assertUnderActiveAdsCap(ad.communityIds, { excludeAdId: adId })
  await assertUnderActiveGlobalAdsCap(ad.isGlobal, { excludeAdId: adId })
  return updateDoc(doc(db, 'sponsoredAds', adId), sponsoredAdFields(ad))
}

export function deleteSponsoredAd(adId) {
  return deleteDoc(doc(db, 'sponsoredAds', adId))
}
