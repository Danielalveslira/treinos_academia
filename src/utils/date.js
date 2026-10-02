// Normaliza datas pra exibição: timestamptz do Supabase chega como string ISO, nunca
// como Firestore Timestamp -- o .toDate() ainda tratado aqui é só pra qualquer resíduo
// legado que por acaso ainda exista. Nunca lança: entrada ausente ou inválida sempre
// vira null (nunca "Invalid Date" nem epoch 1970 por `new Date(null)`/`new Date(undefined)`).
export function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
