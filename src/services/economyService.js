import {
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'

const EMPTY_WALLET = { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }

// sessionStorage é por aba, sem nenhuma sincronização entre abas/dispositivos -- sem um
// teto de idade, um valor gravado aqui poderia ficar visualmente desatualizado pelo
// resto da sessão (inclusive sobrevivendo a reloads, já que sessionStorage não se limpa
// nisso), mesmo que o saldo real tenha mudado por outro caminho (outra aba, ajuste
// administrativo). Mesmo TTL de config-service.js (5min) por consistência -- curto o
// bastante pra nunca ficar perceptivelmente errado, longo o bastante pra continuar
// evitando 1 leitura do Firestore por navegação.
const CACHE_TTL_MS = 5 * 60 * 1000

const registerQualifiedActivityCallable = httpsCallable(functions, 'registerQualifiedActivity')
const voteOnPostCallable = httpsCallable(functions, 'voteOnPost')

function cacheKey(uid) {
  return `wallet:${uid}`
}

function readCache(uid) {
  try {
    const raw = sessionStorage.getItem(cacheKey(uid))
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (Date.now() - entry.cachedAtMs > CACHE_TTL_MS) return null
    return entry.wallet
  } catch {
    return null
  }
}

function writeCache(uid, wallet) {
  try {
    sessionStorage.setItem(cacheKey(uid), JSON.stringify({ wallet, cachedAtMs: Date.now() }))
  } catch {
    // sessionStorage pode estar bloqueado (modo privado, storage cheio) -- a leitura sob
    // demanda continua funcionando, só perde o cache entre navegações/reloads.
  }
}

// Leitura sob demanda com cache de sessão (com TTL, ver CACHE_TTL_MS) -- nunca um
// listener (onSnapshot) permanente. wallet/current é pequeno e muda raramente (no
// máximo 1x/dia na Fase 1), então uma leitura a cada poucos minutos (ou até o cache ser
// atualizado por registerQualifiedActivity) já cobre a UX sem manter uma conexão aberta
// o tempo todo.
export async function getWallet(uid, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = readCache(uid)
    if (cached) return cached
  }
  const snapshot = await getDoc(doc(db, 'users', uid, 'wallet', 'current'))
  const wallet = snapshot.exists() ? snapshot.data() : EMPTY_WALLET
  writeCache(uid, wallet)
  return wallet
}

// A própria resposta da callable já diz quanto foi creditado quando o reward é
// concedido -- atualiza o cache local a partir dela (e reinicia o TTL, ver writeCache),
// sem precisar reler o Firestore.
export async function registerQualifiedActivity(uid) {
  const result = (await registerQualifiedActivityCallable()).data
  if (result?.granted) {
    const current = readCache(uid) || EMPTY_WALLET
    writeCache(uid, {
      ...current,
      coinBalance: current.coinBalance + result.rewardCoins,
      lifetimeCoinsEarned: current.lifetimeCoinsEarned + result.rewardCoins,
    })
  }
  return result
}

// Teto do operador `in` do Firestore -- também o tamanho de página do feed
// (FEED_PAGE_SIZE em statusesService.js), então normalmente cabe tudo numa página só;
// o loop abaixo só existe pro caso desse tamanho de página crescer no futuro.
const VOTE_QUERY_CHUNK_SIZE = 30

// Voto econômico (Fase 2) -- deliberadamente em statuses/{id}/economyVotes/{uid}, nunca
// em statuses/{id}/votes/{uid} (isso é o voto de ENQUETE, gratuito, sem relação com a
// carteira; ver StatusCard.jsx/statusesService.js). value: 1 (positivo), -1 (negativo)
// ou null (remover o voto).
//
// Elimina o N+1 de round-trips (N getDoc separados, um por card) trocando por 1 única
// consulta/round-trip por página de feed (collection group + `in` sobre o id do
// documento) -- ver useMyEconomyVotes.js, o único chamador esperado. IMPORTANTE sobre
// custo: isto reduz o número de IDAS AO SERVIDOR (1 em vez de N), não necessariamente o
// número de DOCUMENT READS cobrados -- o Firestore cobra por documento efetivamente
// retornado na consulta, não por "1 leitura por query". Se o usuário votou em V das N
// publicações da página, o custo passa a ser ~V reads (mínimo de 1 read mesmo se V=0,
// cobrança mínima de toda consulta), contra N reads do getDoc por card de antes -- ou
// seja, a economia de LEITURAS é real e proporcional a quantos posts ficaram sem voto
// (o caso comum), mas se o usuário tivesse votado nos N posts inteiros, o número de
// reads seria o mesmo de antes (só o número de round-trips HTTP cairia).
// Devolve só as publicações em que o usuário JÁ votou; ausência de uma chave = sem voto.
export async function getMyEconomyVotesForStatuses(uid, statusIds) {
  if (statusIds.length === 0) return {}
  const chunks = []
  for (let i = 0; i < statusIds.length; i += VOTE_QUERY_CHUNK_SIZE) {
    chunks.push(statusIds.slice(i, i + VOTE_QUERY_CHUNK_SIZE))
  }
  const snapshots = await Promise.all(
    chunks.map((chunk) => {
      const refs = chunk.map((statusId) => doc(db, 'statuses', statusId, 'economyVotes', uid))
      return getDocs(query(collectionGroup(db, 'economyVotes'), where(documentId(), 'in', refs)))
    })
  )
  const votesByStatusId = {}
  for (const snapshot of snapshots) {
    for (const item of snapshot.docs) {
      // item.ref.parent é a subcoleção economyVotes; .parent dela é o status pai.
      votesByStatusId[item.ref.parent.parent.id] = item.data()
    }
  }
  return votesByStatusId
}

// Só a primeira vez que o usuário vota nesta publicação cobra EvoCoins (result.charged)
// -- trocar de direção ou remover depois é grátis, sem reembolso. Atualiza o cache local
// da carteira a partir da própria resposta, mesma ideia de registerQualifiedActivity.
export async function castVote(uid, statusId, value) {
  const result = (await voteOnPostCallable({ statusId, value })).data
  if (result?.charged) {
    const current = readCache(uid) || EMPTY_WALLET
    writeCache(uid, { ...current, coinBalance: current.coinBalance - result.costCoins })
  }
  return result
}

// Mesmo padrão de clearCachedLegalAccess (utils/legal.js): limpa em toda troca de
// autenticação, nunca deixa o saldo de uma conta anterior visível para a próxima sessão
// no mesmo navegador.
export function clearCachedWallet(storage = globalThis.sessionStorage) {
  try {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index)
      if (key?.startsWith('wallet:')) storage.removeItem(key)
    }
  } catch {
    // sessionStorage pode não existir ou estar bloqueado; nada a limpar nesse caso.
  }
}
