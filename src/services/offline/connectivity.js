// `navigator.onLine` é só uma DICA: true não prova que o backend responde (Wi‑Fi sem saída, portal
// cativo, rede instável de academia). Antes de gastar um envio de verdade, o Sync Engine confirma o
// acesso com uma requisição barata ao endpoint de saúde do Auth (público, sem corpo útil) e guarda o
// resultado por um tempo curto, para nunca virar polling.

export function isBrowserOffline() {
  return globalThis.navigator?.onLine === false
}

export function createProbe({
  baseUrl,
  anonKey,
  fetcher = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  reachableTtlMs = 15_000,
  unreachableTtlMs = 3_000,
  timeoutMs = 4_000,
} = {}) {
  let last = null // { ok, at }

  // `force` (evento online, "Sincronizar agora", finalizar treino): o usuário/o navegador acabou de dizer
  // que há rede, então ignora o resultado em cache -- senão uma falha de segundos atrás faria o pedido
  // retornar "inalcançável" sem nem tentar.
  async function probe({ force = false } = {}) {
    if (isBrowserOffline()) return false
    if (!baseUrl) return true // sem URL configurada (testes/ambiente): não bloqueia; o envio decide
    const age = last ? now() - last.at : Infinity
    if (!force && last && age < (last.ok ? reachableTtlMs : unreachableTtlMs)) return last.ok
    let ok = false
    try {
      const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/auth/v1/health`, {
        method: 'GET',
        headers: anonKey ? { apikey: anonKey } : {},
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
      })
      // Qualquer resposta HTTP abaixo de 500 prova que o backend está alcançável.
      ok = response.status < 500
    } catch {
      ok = false
    }
    last = { ok, at: now() }
    return ok
  }

  return {
    probe,
    // Um envio que deu certo já provou o acesso: o próximo lote não precisa de outra sondagem.
    markReachable: () => {
      last = { ok: true, at: now() }
    },
    markUnreachable: () => {
      last = { ok: false, at: now() }
    },
    reset: () => {
      last = null
    },
  }
}
