import { GREETING_WELCOME_FROM_MS } from './config.js'

// Elegível = conta criada a partir do corte da release, com perfil concluído (nome de usuário definido),
// ativa, ainda SEM confirmação das boas-vindas (`greeting_welcome_seen_at` conhecido e nulo) e com o
// servidor alcançável: offline nunca decide, porque não dá para saber se outro aparelho já confirmou.
// `welcomeSeenAt` precisa ser exatamente null: undefined = coluna ausente/snapshot antigo = não sabemos.
export function isWelcomeEligible({
  createdAt,
  username,
  accountStatus,
  welcomeSeenAt,
  offlineLocal = false,
  cutoffMs = GREETING_WELCOME_FROM_MS,
}) {
  if (!Number.isFinite(cutoffMs) || offlineLocal) return false
  if (welcomeSeenAt !== null) return false
  if (accountStatus !== 'active' || !username) return false
  const created = Date.parse(createdAt)
  return Number.isFinite(created) && created >= cutoffMs
}

// Single-flight POR CONTA: duas montagens/eventos simultâneos compartilham a mesma chamada. O mapa só
// guarda o que está em voo; o resultado de uma conta nunca é entregue a outra (a chave é o userId).
const inFlight = new Map()

export function acknowledgeWelcomeOnce(userId, send) {
  if (!userId) return Promise.resolve(null)
  const running = inFlight.get(userId)
  if (running) return running
  const promise = Promise.resolve()
    .then(send)
    .finally(() => {
      if (inFlight.get(userId) === promise) inFlight.delete(userId)
    })
  inFlight.set(userId, promise)
  return promise
}
