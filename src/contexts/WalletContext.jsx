import { createContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase/config'
import { useAuth } from '../hooks/useAuth'
import { getMyEvocoinDay, getWallet, peekCachedWallet } from '../services/economyService'
import { awardDelta, dailyCoinsFromServer } from '../utils/evocoins'
import { persistHomeSnapshot } from '../services/offline/snapshotWriter'
import { saoPauloDayKey } from '../utils/qualifiedActivity'

const EMPTY_WALLET = { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }

function mapWalletRow(row) {
  return row
    ? {
        coinBalance: row.coin_balance,
        lifetimeCoinsEarned: row.lifetime_coins_earned,
        cashBalance: row.cash_balance,
      }
    : EMPTY_WALLET
}

export const WalletContext = createContext(null)

// O que o header mostra: o último valor CONHECIDO e de onde veio. `source: 'server'` = leitura/evento
// confirmado pelo servidor nesta sessão; `'snapshot'` = último valor guardado no aparelho (cold start
// offline). SOMENTE EXIBIÇÃO: nunca autoriza gasto/compra -- quem decide é o servidor (RPCs), e o `wallet`
// autêntico abaixo continua vazio offline.
function toDisplay(uid, wallet, source, savedAt = null) {
  return { uid, ...wallet, source, savedAt }
}

// Fonte ÚNICA de verdade da carteira no frontend: 1 subscription Realtime
// (public.wallets, filtrada pelo próprio uid) por usuário autenticado — Header,
// EvoCash, CreateCommunity, PromoteDialog e qualquer tela futura consomem este MESMO
// estado via useWallet() (hooks/useWallet.js), nunca uma subscription própria. Mesmo
// padrão do listener de perfil em AuthContext.jsx: `revision` + `active` garantem que
// uma resposta atrasada de um usuário anterior nunca sobrescreve o estado do usuário
// atual depois de um logout/troca de conta rápida.
//
// EvoCoins por participação: o cliente nunca calcula quanto ganhou. Um crédito é percebido
// quando a reputação (lifetime_coins_earned) SOBE num evento confirmado pelo servidor --
// gastar não mexe nesse campo. A base dessa comparação vem sempre de uma leitura fresca (ou do
// próprio Realtime), nunca do cache de sessão, para um saldo antigo não virar "+N" falso.
// Cada crédito dispara UMA leitura de get_my_evocoin_day (<= 10 por usuário/dia); sem polling.
export function WalletProvider({ children }) {
  const { user, deletionStatus, offlineLocal, offlineHome } = useAuth()
  const [wallet, setWallet] = useState(EMPTY_WALLET)
  const [display, setDisplay] = useState(null)
  const displayUidRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dailyCoins, setDailyCoins] = useState(null)
  const [lastAward, setLastAward] = useState(null)
  const awardSeq = useRef(0)

  useEffect(() => {
    let active = true
    let revision = 0
    let channel = null
    // null = ainda sem base confiável (nada de "+N" até a primeira leitura fresca/evento).
    let baselineLifetime = null

    // Troca de conta (ou logout): nada do usuário anterior sobrevive, nem o último valor conhecido.
    if (displayUidRef.current !== (user?.uid ?? null)) {
      displayUidRef.current = user?.uid ?? null
      setDisplay(null)
      setDailyCoins(null)
    }

    if (!user || deletionStatus) {
      setWallet(EMPTY_WALLET)
      setLoading(false)
      setError(null)
      setDailyCoins(null)
      setLastAward(null)
      setDisplay(null)
      return
    }

    if (offlineLocal) {
      // Modo offline local: nenhuma RPC e nenhum Realtime. O header mostra o ÚLTIMO valor conhecido (snapshot
      // da Home do cold start) ou, sem snapshot, "—" -- nunca um 0 inventado. `wallet` (autêntico) fica
      // vazio: o saldo guardado só pinta a tela e jamais serve para autorizar um gasto.
      const saved = offlineHome?.wallet
      setWallet(EMPTY_WALLET)
      setLoading(false)
      setError(null)
      setLastAward(null)
      setDisplay(
        saved
          ? toDisplay(
              user.uid,
              {
                coinBalance: saved.coinBalance,
                lifetimeCoinsEarned: saved.lifetimeCoinsEarned,
                cashBalance: saved.cashBalance,
              },
              'snapshot',
              saved.saved_at
            )
          : null
      )
      // "EvoCoins de hoje" só vale no mesmo dia do negócio em que foi guardado; ontem não vira hoje.
      const daily = offlineHome?.daily_coins
      setDailyCoins(
        daily && daily.day === saoPauloDayKey()
          ? { earned: daily.earned, limit: daily.limit, day: daily.day }
          : null
      )
      return
    }

    const current = ++revision
    let snapshotReceived = false
    setWallet(EMPTY_WALLET)
    setLoading(true)
    setError(null)
    setLastAward(null)

    function refreshDaily() {
      getMyEvocoinDay()
        .then((raw) => {
          if (!active || revision !== current) return
          const daily = dailyCoinsFromServer(raw)
          setDailyCoins(daily)
          if (daily) persistHomeSnapshot(user.uid, { daily_coins: daily })
        })
        .catch(() => {}) // informativo: nunca atrapalha a ação principal
    }

    // Pinta na hora com o cache (se houver) e confirma com uma leitura fresca, que também fixa
    // a base do "+N".
    const cachedWallet = peekCachedWallet(user.uid)
    if (cachedWallet) {
      setDisplay(toDisplay(user.uid, cachedWallet, 'snapshot'))
    }
    getWallet(user.uid, { forceRefresh: true })
      .then((fresh) => {
        if (!active || revision !== current || snapshotReceived) return
        baselineLifetime = fresh.lifetimeCoinsEarned
        setWallet(fresh)
        setLoading(false)
        setError(null)
        setDisplay(toDisplay(user.uid, fresh, 'server'))
        persistHomeSnapshot(user.uid, { wallet: fresh })
      })
      .catch(() => {
        if (!active || revision !== current || snapshotReceived) return
        setLoading(false)
        setError('Não foi possível confirmar o saldo. Tente novamente.')
      })
    refreshDaily()

    channel = supabase
      .channel(`wallet-changes-${user.uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.uid}` },
        (payload) => {
          if (!active || revision !== current) return
          snapshotReceived = true
          const next = mapWalletRow(payload.new)
          const earned = awardDelta(baselineLifetime, next.lifetimeCoinsEarned)
          baselineLifetime = next.lifetimeCoinsEarned
          setWallet(next)
          setLoading(false)
          setError(null)
          if (payload.new) {
            setDisplay(toDisplay(user.uid, next, 'server'))
            persistHomeSnapshot(user.uid, { wallet: next })
          }
          if (earned > 0) {
            setLastAward({ id: ++awardSeq.current, coins: earned })
            refreshDaily()
          }
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
  }, [user?.uid, deletionStatus, offlineLocal, offlineHome])

  // Só entrega o último valor conhecido ao DONO: um display de outra conta (troca rápida) nunca vaza.
  const shown = display && display.uid === user?.uid ? display : null

  return (
    <WalletContext.Provider
      value={{ wallet, loading, error, dailyCoins, lastAward, display: shown }}
    >
      {children}
    </WalletContext.Provider>
  )
}
