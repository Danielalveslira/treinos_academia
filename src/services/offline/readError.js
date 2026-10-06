// Decide se uma falha de LEITURA pode ser coberta pelo cache local.
//
//  - 'auth'         -> sessão/permissão. NUNCA vira cache: o usuário precisa ver o problema (e o
//                      servidor continua sendo a barreira de acesso, não o IndexedDB).
//  - 'connectivity' -> a requisição nem chegou/voltou do servidor (rede, DNS, gateway). Único
//                      caso em que o cache local pode responder.
//  - 'other'        -> qualquer outra coisa (erro SQL, RPC com bug, validação). Propaga como hoje.
//
// O supabase-js (postgrest-js 2.x) NÃO lança em falha de rede: devolve
// { error: { message: 'TypeError: Failed to fetch', code: '' } }, e os serviços relançam esse
// objeto. Erros reais do PostgREST sempre têm `code` (PGRSTxxx ou SQLSTATE).

const AUTH_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303', '42501', '28000', '28P01'])
const AUTH_STATUS = new Set([401, 403])
const CONNECTIVITY_STATUS = new Set([0, 408, 502, 503, 504])
const AUTH_MESSAGE =
  /jwt|not[_ ]authenticated|app_access_denied|permission denied|invalid claim|refresh[_ ]token/i
const NETWORK_MESSAGE =
  /^(TypeError|FetchError|NetworkError)\b|failed to fetch|network ?(error|request failed)|load failed|fetch failed|timed? ?out|econnreset|enotfound|econnrefused/i

export function classifyReadError(error, { online = globalThis.navigator?.onLine } = {}) {
  if (!error) return 'other'
  const code = typeof error.code === 'string' ? error.code : ''
  const status = Number(error.status ?? error.statusCode)
  const message = typeof error.message === 'string' ? error.message : ''

  if (AUTH_CODES.has(code) || AUTH_STATUS.has(status) || AUTH_MESSAGE.test(message)) return 'auth'
  // Cancelamento deliberado (troca de tela/filtro) não é falha de rede.
  if (error.name === 'AbortError' || /aborted/i.test(`${message} ${error.hint || ''}`))
    return 'other'
  if (error instanceof TypeError) return 'connectivity'
  // Erro estruturado do servidor (com código SQLSTATE/PGRST) nunca é "sem rede".
  if (code) return 'other'
  if (NETWORK_MESSAGE.test(message) || CONNECTIVITY_STATUS.has(status)) return 'connectivity'
  // Sem código nem mensagem reconhecível, mas o navegador sabe que está offline.
  if (online === false) return 'connectivity'
  return 'other'
}
