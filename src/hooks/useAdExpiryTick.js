import { useEffect, useState } from 'react'
import { nextExpiry, referenceNow } from '../utils/sponsoredAds'

const MAX_TIMEOUT_MS = 2 ** 31 - 1

// Devolve um contador que muda UMA vez no instante (relógio do servidor) em que a próxima campanha da
// lista vence, para a composição ser refeita e o anúncio sair da tela sem esperar a cache. É um único
// setTimeout para o instante exato -- nada de polling -- e só existe quando alguma campanha tem validade.
export function useAdExpiryTick(ads) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const now = referenceNow()
    const next = nextExpiry(ads, now)
    if (now === null || next === null) return undefined
    const id = setTimeout(
      () => setTick((value) => value + 1),
      Math.min(next - now + 50, MAX_TIMEOUT_MS)
    )
    return () => clearTimeout(id)
  }, [ads, tick])
  return tick
}
