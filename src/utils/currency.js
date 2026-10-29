// BRL price input, digit-stream style (like an ATM amount field): every keystroke's full
// digit content is re-read and treated directly as centavos, so there is never a decimal
// string to parse and never a float multiply/divide on the way to the integer the backend
// stores (see save_storefront_product's `priceCentavos` column, matching formatCentavosBRL's
// own comment in utils/format.js about keeping money as integer centavos).
const MAX_CENTAVOS = 999999999999 // backend regex: priceCentavos ~ '^[0-9]{1,12}$'

export function digitsToCentavos(raw) {
  // Capped at 12 digits before ever becoming a Number, so it can never land outside the
  // safe-integer range in the first place (a 12-digit value always is).
  const digits = String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, 12)
  if (!digits) return null
  const n = Number(digits)
  return n > 0 ? Math.min(n, MAX_CENTAVOS) : null
}

export function centavosToDigits(centavos) {
  if (centavos == null || centavos === '') return ''
  const n = Math.trunc(Number(centavos))
  return n > 0 ? String(n) : ''
}
