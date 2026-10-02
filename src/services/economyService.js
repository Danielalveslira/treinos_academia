import { supabase } from '../supabase/config'

const EMPTY_WALLET = { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }

// sessionStorage é por aba, sem nenhuma sincronização entre abas/dispositivos -- sem um
// teto de idade, um valor gravado aqui poderia ficar visualmente desatualizado pelo
// resto da sessão (inclusive sobrevivendo a reloads, já que sessionStorage não se limpa
// nisso), mesmo que o saldo real tenha mudado por outro caminho (outra aba, ajuste
// administrativo). TTL de 5min -- curto o bastante pra nunca ficar perceptivelmente
// errado, longo o bastante pra continuar evitando uma leitura por navegação.
const CACHE_TTL_MS = 5 * 60 * 1000

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
// listener permanente (o realtime fica a cargo de WalletContext.jsx, canal
// postgres_changes). wallet/current é pequeno e muda raramente (no máximo 1x/dia na
// Fase 1), então uma leitura a cada poucos minutos (ou até o cache ser atualizado por
// registerQualifiedActivity) já cobre a UX sem manter uma conexão aberta o tempo todo.
export async function getWallet(uid, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = readCache(uid)
    if (cached) return cached
  }
  const { data, error } = await supabase.rpc('get_my_wallet')
  if (error) throw error
  const wallet = {
    coinBalance: data.coin_balance,
    lifetimeCoinsEarned: data.lifetime_coins_earned,
    cashBalance: data.cash_balance,
  }
  writeCache(uid, wallet)
  return wallet
}

// O crédito em si é refletido pelo canal postgres_changes único de WalletContext.jsx
// assim que o Supabase confirma a escrita de _wallet_credit_coins (register_qualified_activity,
// RPC) -- nunca precisa de patch manual de cache aqui, nem do uid (a RPC usa auth.uid()).
export async function registerQualifiedActivity() {
  const { data, error } = await supabase.rpc('register_qualified_activity')
  if (error) throw error
  return data
}

// Tamanho de lote arbitrário (igual ao FEED_PAGE_SIZE de statusesService.js, então
// normalmente cabe tudo num lote só) -- o loop abaixo só existe como proteção caso esse
// tamanho de página cresça no futuro; o Postgres não impõe limite de itens num `.in()`.
const VOTE_QUERY_CHUNK_SIZE = 30

// Voto econômico (Fase 2) -- deliberadamente em status_economy_votes, nunca na mesma
// tabela do voto de ENQUETE (gratuito, sem relação com a carteira; ver
// StatusCard.jsx/statusesService.js). value: 1 (positivo), -1 (negativo) ou null
// (remover o voto).
//
// Elimina o N+1 de round-trips (N consultas separadas, uma por card) trocando por 1
// única consulta/round-trip por página de feed (`.in()` sobre os ids da página) -- ver
// useMyEconomyVotes.js, o único chamador esperado.
// Devolve só as publicações em que o usuário JÁ votou; ausência de uma chave = sem voto.
export async function getMyEconomyVotesForStatuses(uid, statusIds) {
  if (statusIds.length === 0) return {}
  const chunks = []
  for (let i = 0; i < statusIds.length; i += VOTE_QUERY_CHUNK_SIZE) {
    chunks.push(statusIds.slice(i, i + VOTE_QUERY_CHUNK_SIZE))
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase.from('status_economy_votes').select('*').eq('user_id', uid).in('status_id', chunk)
    )
  )
  const votesByStatusId = {}
  for (const { data, error } of results) {
    if (error) throw error
    for (const row of data) {
      votesByStatusId[row.status_id] = {
        value: row.value,
        charged: row.charged,
        rewardState: row.reward_state,
      }
    }
  }
  return votesByStatusId
}

// Só a primeira vez que o usuário vota nesta publicação cobra EvoCoins (result.action
// === 'create') -- trocar de direção ou remover depois é grátis, sem reembolso. O
// débito em si é refletido pela subscription Realtime única de WalletContext.jsx assim
// que o Supabase confirma a escrita de _wallet_debit_coins (cast_vote, RPC) -- nunca
// precisa de patch manual de cache aqui, nem do uid (a RPC usa auth.uid()).
export async function castVote(statusId, value) {
  const { data, error } = await supabase.rpc('cast_vote', { p_status_id: statusId, p_value: value })
  if (error) throw error
  return data
}

// "Quem curtiu" -- nunca lê status_economy_votes direto (RLS só libera o próprio voto); a RPC
// devolve só { userId, username, avatarPath } de APOIADORES, mais recentes primeiro, em páginas.
// cursor é o nextCursor da página anterior ({ at, userId }) ou null na primeira. NÃO existe
// equivalente para o negativo: essa identidade não é exposta em lugar nenhum.
export async function listPostSupporters(statusId, { cursor = null, limit = 20 } = {}) {
  const { data, error } = await supabase.rpc('list_post_supporters', {
    p_status_id: statusId,
    p_cursor_at: cursor?.at ?? null,
    p_cursor_user: cursor?.userId ?? null,
    p_limit: limit,
  })
  if (error) throw error
  return data
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
