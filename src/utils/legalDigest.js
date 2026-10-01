// Mesmo algoritmo de legalDigest.js (legalDigest): sha256 de
// JSON.stringify({manifest, documents}). Calculado aqui, no cliente, porque a RPC
// accept_legal_documents só compara esse valor contra o que já está gravado em
// legal_policy (ver scripts/seed-legal.mjs) — nunca confia nele como fonte de verdade.
export async function legalDigest(manifest, documents) {
  const json = JSON.stringify({ manifest, documents })
  const bytes = new TextEncoder().encode(json)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
