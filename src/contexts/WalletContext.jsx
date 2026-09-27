import { createContext, useEffect, useState } from 'react'
import { supabase } from '../supabase/config'
import { useAuth } from '../hooks/useAuth'
import { getWallet } from '../services/economyService'

const EMPTY_WALLET = { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }

function mapWalletRow(row) {
  return row
    ? { coinBalance: row.coin_balance, lifetimeCoinsEarned: row.lifetime_coins_earned, cashBalance: row.cash_balance }
    : EMPTY_WALLET
}

export const WalletContext = createContext(null)

// Fonte ÚNICA de verdade da carteira no frontend: 1 subscription Realtime
// (public.wallets, filtrada pelo próprio uid) por usuário autenticado — Header,
// EvoCash, CreateCommunity, PromoteDialog e qualquer tela futura consomem este MESMO
// estado via useWallet() (hooks/useWallet.js), nunca uma subscription própria. Mesmo
// padrão do listener de perfil em AuthContext.jsx: `revision` + `active` garantem que
// uma resposta atrasada de um usuário anterior nunca sobrescreve o estado do usuário
// atual depois de um logout/troca de conta rápida.
//
// TODO(economia): a tabela wallets ainda é só um stub (sempre zero) até a fase de
// EvoCoins/EvoCash ser portada — a estrutura de sincronização já está pronta pra
// quando as RPCs de crédito/débito passarem a escrever nela de verdade.
export function WalletProvider({ children }) {
  const { user, deletionStatus } = useAuth()
  const [wallet, setWallet] = useState(EMPTY_WALLET)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    let revision = 0
    let channel = null

    if (!user || deletionStatus) {
      setWallet(EMPTY_WALLET)
      setLoading(false)
      setError(null)
      return
    }

    const current = ++revision
    let snapshotReceived = false
    setWallet(EMPTY_WALLET)
    setLoading(true)
    setError(null)

    getWallet(user.uid)
      .then((cached) => {
        if (active && revision === current && !snapshotReceived) setWallet(cached)
      })
      .catch(() => {})

    channel = supabase
      .channel(`wallet-changes-${user.uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.uid}` },
        (payload) => {
          if (!active || revision !== current) return
          snapshotReceived = true
          setWallet(mapWalletRow(payload.new))
          setLoading(false)
          setError(null)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && active && revision === current && !snapshotReceived) {
          setLoading(false)
        }
      })

    return () => {
      active = false
      channel?.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, deletionStatus])

  return <WalletContext.Provider value={{ wallet, loading, error }}>{children}</WalletContext.Provider>
}
