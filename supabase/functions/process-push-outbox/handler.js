// Porta de entrada do worker: decide se a requisição pode sequer tocar na fila. Separada de
// index.ts (Deno) para ser testada em Node. Nenhum caminho de recusa chama `run`, então uma
// requisição sem o segredo nunca consulta, faz claim nem consome a fila.
export const WORKER_SECRET_HEADER = 'x-push-worker-secret'
const MIN_SECRET_LENGTH = 32

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

// Compara os SHA-256 em tempo constante: não vaza o tamanho nem o prefixo do segredo.
export async function secretsMatch(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false
  const [a, b] = await Promise.all([digest(received), digest(expected)])
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index]
  return diff === 0
}

function json(body, status) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status })
}

export function createWorkerHandler({ workerSecret, vapidReady, run, logError = () => {} }) {
  return async function handle(req) {
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    // Servidor sem segredo utilizável: ninguém pode ser autenticado, nada é processado.
    if (typeof workerSecret !== 'string' || workerSecret.length < MIN_SECRET_LENGTH) {
      logError('[Push] PUSH_WORKER_SECRET missing or too short')
      return json({ error: 'PUSH_NOT_CONFIGURED' }, 503)
    }
    if (!(await secretsMatch(req.headers.get(WORKER_SECRET_HEADER), workerSecret))) {
      return json({ error: 'UNAUTHORIZED' }, 401)
    }
    if (!vapidReady) return json({ error: 'PUSH_NOT_CONFIGURED' }, 503)
    try {
      return json(await run(), 200)
    } catch (error) {
      // Só o código/nome do erro: mensagens do provedor podem conter o endpoint da subscription.
      logError('[Push] worker failed', error?.code ?? error?.name)
      return json({ error: 'PUSH_WORKER_FAILED' }, 500)
    }
  }
}
