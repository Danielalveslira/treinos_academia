// Normalização genérica pra busca/comparação client-side -- só usada pra decidir "esse
// texto casa com essa busca", NUNCA pro valor de apresentação (o nome original, com
// acento, é sempre o que é mostrado na tela).
export function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}
