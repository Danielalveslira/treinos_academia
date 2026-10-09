import { supabase } from '../../supabase/config'
import { createAdMetricsCollector } from './collector'

// Ligação do coletor ao navegador real. Este módulo só é carregado (import dinâmico em hooks/useAdMetrics.js)
// quando a flag de build VITE_AD_METRICS_ENABLED === 'true'; com a flag desligada nada daqui roda nem baixa.

const RPC = 'record_ad_events'

function randomId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// 5xx/429/falha de rede podem dar certo depois (mesmos ids => idempotente); o resto é definitivo.
const retryableStatus = (status) => !status || status === 429 || status >= 500

async function send(events, { keepalive, userId }) {
  const { data } = await supabase.auth.getSession()
  const session = data?.session
  // Nunca envia eventos de uma conta com o token de outra.
  if (!session || session.user.id !== userId) return { ok: false, retryable: false }

  if (keepalive) {
    // Saída da página: supabase-js não expõe keepalive, então vai um fetch direto com o JWT da sessão (um
    // beacon sem cabeçalhos não levaria o token). Limite do navegador para keepalive: 64 KiB; o lote tem <= 8 KiB.
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/${RPC}`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ events }),
      })
      if (!response.ok) return { ok: false, retryable: retryableStatus(response.status) }
      const ack = await response.json().catch(() => null)
      return { ok: true, enabled: ack?.enabled !== false }
    } catch {
      return { ok: false, retryable: true }
    }
  }

  // `status` 0 = falha de rede; erros de negócio da RPC (INVALID_EVENTS...) chegam como 4xx e são definitivos.
  const { data: ack, error, status } = await supabase.rpc(RPC, { events })
  if (error) return { ok: false, retryable: retryableStatus(status) }
  return { ok: true, enabled: ack?.enabled !== false }
}

const collector = createAdMetricsCollector({
  IntersectionObserverCtor:
    typeof IntersectionObserver === 'undefined' ? null : IntersectionObserver,
  documentRef: document,
  windowRef: window,
  now: () => performance.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id),
  isOnline: () => navigator.onLine !== false,
  randomId,
  send,
})

// A conta do coletor acompanha a sessão do Supabase: logout/troca de conta zeram buffer e sessões contadas.
// O callback só atribui uma variável (nada de chamar auth dentro dele, para não travar o cliente).
supabase.auth.getSession().then(({ data }) => collector.setUser(data?.session?.user?.id ?? null))
supabase.auth.onAuthStateChange((_event, session) => collector.setUser(session?.user?.id ?? null))

export function observeAd(element, meta) {
  return collector.observe(element, meta)
}

export function trackAdClick(meta) {
  collector.click(meta)
}
