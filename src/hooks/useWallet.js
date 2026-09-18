import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { getWallet } from '../services/economyService'

const EMPTY_WALLET = { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }

// Leitura sob demanda (cache de sessão em economyService.js) -- só busca de verdade
// quando um componente que precisa mostrar o saldo é montado (ex.: WalletCard no
// Profile), nunca um listener em tempo real vivendo pela sessão inteira.
export function useWallet() {
  const { user } = useAuth()
  const [wallet, setWallet] = useState(EMPTY_WALLET)
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    async (options) => {
      if (!user) return
      setLoading(true)
      try {
        setWallet(await getWallet(user.uid, options))
      } finally {
        setLoading(false)
      }
    },
    [user]
  )

  useEffect(() => {
    if (!user) {
      setWallet(EMPTY_WALLET)
      setLoading(false)
      return
    }
    load()
  }, [user, load])

  return { wallet, loading, refresh: () => load({ forceRefresh: true }) }
}
