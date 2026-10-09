// Relógio do servidor, sem requisição extra: cada resposta do Supabase já traz o cabeçalho HTTP `Date`
// (resolução de 1 s). Guardamos só o desvio entre ele e o relógio do aparelho. Serve para decidir se uma
// campanha (expires_at) ainda vale sem depender de um aparelho com a hora errada. Sem nenhuma amostra
// (ainda não houve resposta, ou o navegador não expôs o cabeçalho) hasServerClock() é false e a
// revalidação local é dispensada: a consulta de anúncios já é filtrada com o `now` do próprio Postgres e a
// lista vive no máximo o TTL da cache de páginas.
let offsetMs = 0
let lastServerMs = 0

// `dateHeader` vem de response.headers.get('date'). O valor vem truncado ao segundo; somar 500 ms centraliza
// o erro. Amostras que andam para trás (resposta antiga servida de cache) são ignoradas.
export function observeServerDate(dateHeader, deviceNow = Date.now()) {
  const parsed = Date.parse(dateHeader || '')
  if (!Number.isFinite(parsed)) return
  const serverMs = parsed + 500
  if (serverMs < lastServerMs) return
  lastServerMs = serverMs
  offsetMs = serverMs - deviceNow
}

export function serverNow(deviceNow = Date.now()) {
  return deviceNow + offsetMs
}

// Só há como comparar vencimentos no client quando já se observou o relógio do servidor. Sem isso (cabeçalho
// `Date` não exposto pelo CORS, nenhuma resposta ainda) quem chama NÃO deve usar o relógio do aparelho.
export function hasServerClock() {
  return lastServerMs > 0
}

export function resetServerClock() {
  offsetMs = 0
  lastServerMs = 0
}
