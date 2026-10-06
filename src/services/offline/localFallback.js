// Marca um resultado que veio do IndexedDB porque o servidor estava inalcançável. Duas
// consequências, ambas essenciais:
//  1. pageCache NÃO guarda esse valor em memória (senão um dado antigo ficaria "preso" por
//     minutos mesmo depois da conexão voltar) -- ver fetchCached.
//  2. a UI pode saber que está mostrando dados salvos no aparelho (isLocalFallback).
// WeakSet: não altera o valor (arrays e objetos seguem idênticos) e não vaza memória.
const fromLocal = new WeakSet()

export function markLocalFallback(value) {
  if (value !== null && typeof value === 'object') fromLocal.add(value)
  return value
}

export function isLocalFallback(value) {
  return value !== null && typeof value === 'object' && fromLocal.has(value)
}
