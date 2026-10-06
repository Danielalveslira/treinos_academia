import { useEffect } from 'react'
import { preloadRoute } from '../routeLoaders'
import { isOfflineColdStartEnabled } from '../services/offline/database'

// O Service Worker só pré-cacheia o BOOT; as telas são chunks lazy que entram no cache de assets quando são
// abertas pela primeira vez. Para o cold start offline abrir o app, os chunks das telas que funcionam sem
// rede precisam já estar no cache -- então, com a conta confirmada online e o navegador ocioso, o app busca
// (e o SW guarda) só essas telas. Nada do resto do produto é pré-baixado. Respeita "economia de dados" e
// rede 2G (preloadRoute já ignora) e deixa a tela de gráficos (chunk grande) só para conexão boa.
const SMALL_OFFLINE_ROUTES = ['/', '/exercicios', '/novo-treino', '/historico']

export function useWarmOfflineRoutes(enabled) {
  useEffect(() => {
    if (!enabled || !isOfflineColdStartEnabled() || globalThis.navigator?.onLine === false)
      return undefined
    const connection = globalThis.navigator?.connection
    if (connection?.saveData) return undefined
    const run = () => {
      for (const path of SMALL_OFFLINE_ROUTES) preloadRoute(path)
      if (!connection?.effectiveType || connection.effectiveType === '4g')
        preloadRoute('/progresso')
    }
    if (typeof globalThis.requestIdleCallback === 'function') {
      const id = globalThis.requestIdleCallback(run, { timeout: 10_000 })
      return () => globalThis.cancelIdleCallback?.(id)
    }
    const id = setTimeout(run, 3000)
    return () => clearTimeout(id)
  }, [enabled])
}
