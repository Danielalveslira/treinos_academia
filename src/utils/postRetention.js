// Retenção das publicações de uma comunidade (24h, 30 dias ou sem expiração automática).
// O prazo REAL de cada post é calculado pelo banco no INSERT (trigger
// statuses_apply_retention) e guardado no próprio post -- o cliente nunca envia expires_at.
// Estas funções só servem para a UI (post otimista local, "nunca expira") e nunca decidem nada.

export const NO_AUTO_EXPIRATION = 'no_auto_expiration'

const RETENTION_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

// Mesma conta do trigger, só para o post otimista mostrado antes do próximo refresh do feed.
// Modo desconhecido cai em 24h (comportamento histórico); sem expiração devolve null.
export function expiresAtForRetention(mode, now = Date.now()) {
  if (mode === NO_AUTO_EXPIRATION) return null
  return new Date(now + (RETENTION_MS[mode] ?? RETENTION_MS['24h']))
}

// expires_at nulo só significa "não expira" quando o post diz isso explicitamente --
// um valor ausente por outro motivo (dado incompleto) nunca é tratado como eterno.
export function isNeverExpiring(status) {
  return status?.retentionMode === NO_AUTO_EXPIRATION && status?.expiresAt == null
}
