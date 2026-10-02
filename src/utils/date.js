// ÚNICO lugar do projeto autorizado a conhecer formatos legados de data (guarda em
// src/utils/legacyRuntimeGuard.test.js: nenhum `.toDate`/`.toMillis` fora deste arquivo).
//
// Normaliza datas pra exibição: timestamptz do Supabase chega como string ISO, nunca como
// Firestore Timestamp -- os métodos legados (toDate/toMillis) só são tratados aqui por
// compatibilidade com qualquer resíduo antigo. Nunca lança: entrada ausente ou inválida
// sempre vira null (nunca "Invalid Date" nem epoch 1970 por `new Date(null)`/
// `new Date(undefined)`).
export function toDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  let candidate = value
  if (typeof value === 'object') {
    // Timestamp legado (Firestore): só por compatibilidade.
    if (typeof value.toDate === 'function') {
      try {
        candidate = value.toDate()
      } catch {
        return null
      }
      if (candidate instanceof Date) return Number.isNaN(candidate.getTime()) ? null : candidate
    } else if (typeof value.toMillis === 'function') {
      try {
        candidate = value.toMillis()
      } catch {
        return null
      }
    } else {
      return null
    }
  }
  if (typeof candidate !== 'string' && typeof candidate !== 'number') return null
  const parsed = new Date(candidate)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// Milissegundos desde a época; 0 quando ausente/inválido (mesmo contrato de "sem data"
// usado pelos comparadores de expiração: `toMillis(x) > agora` é false).
export function toMillis(value) {
  const date = toDate(value)
  return date ? date.getTime() : 0
}
