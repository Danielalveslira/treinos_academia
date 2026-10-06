import { attempt } from './database.js'
import { classifyReadError } from './readError.js'
import { markLocalFallback } from './localFallback.js'

// Estratégia de leitura do Evolutus (Fase 2):
//
//   online  -> o Supabase é SEMPRE a fonte; o resultado válido atualiza o IndexedDB em segundo
//              plano (sem bloquear nem falhar a leitura).
//   falha de conectividade -> se houver dado local, devolve-o marcado (markLocalFallback); sem
//              dado local, propaga o erro ORIGINAL.
//   erro de auth/permissão ou qualquer outro erro -> propaga o erro original, sem cache.
//
// `local()` devolve undefined quando não há nada confiável guardado (nunca "vazio de mentira").
export async function readThrough({ remote, persist, local, label = 'read', localOnly = false }) {
  if (localOnly) {
    const cached = await attempt(`${label}:local-only`, local, undefined)
    if (cached === undefined) throw new Error('Dados salvos indisponíveis neste aparelho.')
    return markLocalFallback(cached)
  }
  let value
  try {
    value = await remote()
  } catch (error) {
    if (classifyReadError(error) !== 'connectivity') throw error
    const cached = await attempt(`${label}:local`, local, undefined)
    if (cached === undefined) throw error
    return markLocalFallback(cached)
  }
  // Sem await: a UI nunca espera o disco. attempt nunca rejeita.
  attempt(`${label}:persist`, () => persist(value), undefined)
  return value
}
