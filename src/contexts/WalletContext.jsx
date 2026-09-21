import { createContext, useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../hooks/useAuth'
import { getWallet } from '../services/economyService'

const EMPTY_WALLET = { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }

export const WalletContext = createContext(null)

// Fonte ÚNICA de verdade da carteira no frontend: 1 onSnapshot(users/{uid}/wallet/
// current) por usuário autenticado -- Header, EvoCash, CreateCommunity, PromoteDialog e
// qualquer tela futura consomem este MESMO estado via useWallet() (hooks/useWallet.js),
// nunca um listener próprio. Mesmo padrão já usado (e testado) pelo listener de perfil
// em AuthContext.jsx: `revision` + `active` garantem que uma resposta atrasada de um
// usuário anterior nunca sobrescreve o estado do usuário atual depois de um
// logout/troca de conta rápida.
//
// Qualquer mutação que grave em wallet/current (voto pago, reward diário, reward por
// voto positivo, compra de comunidade, promoção, confirmação administrativa de EvoCash
// -- ver wallet-service.js: creditCoins/debitCoins/creditCash/debitCash) propaga pra cá
// automaticamente assim que o Firestore confirma a escrita, mesmo vinda de outra sessão/
// dispositivo/admin -- sem nenhum código extra na feature que disparou a mutação.
export function WalletProvider({ children }) {
  const { user } = useAuth()
  const [wallet, setWallet] = useState(EMPTY_WALLET)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    let revision = 0

    if (!user) {
      setWallet(EMPTY_WALLET)
      setLoading(false)
      setError(null)
      return
    }

    const current = ++revision
    let snapshotReceived = false
    // Nunca reaproveita a carteira do usuário/revision anterior -- troca de conta (ou
    // primeiro login) sempre reparte do zero até a resposta real deste uid chegar.
    setWallet(EMPTY_WALLET)
    setLoading(true)
    setError(null)

    // Bootstrap só pra evitar a tela nascendo em zero por uma fração de segundo. Como
    // getWallet() e o onSnapshot abaixo disparam quase juntos, nada garante qual dos
    // dois responde primeiro -- snapshotReceived impede que o bootstrap sobrescreva um
    // valor mais recente caso a resposta do cache chegue DEPOIS do primeiro evento do
    // listener (o snapshot, uma vez recebido, é a fonte de verdade dali em diante, sem
    // exceção).
    getWallet(user.uid)
      .then((cached) => {
        if (active && revision === current && !snapshotReceived) setWallet(cached)
      })
      .catch(() => {})

    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid, 'wallet', 'current'),
      (snapshot) => {
        if (!active || revision !== current) return
        snapshotReceived = true
        setWallet(snapshot.exists() ? snapshot.data() : EMPTY_WALLET)
        setLoading(false)
        setError(null)
      },
      (err) => {
        if (!active || revision !== current) return
        console.error('[Wallet] onSnapshot:', err)
        setError(err)
        setLoading(false)
      }
    )

    return () => {
      active = false
      unsubscribe()
    }
    // user?.uid (não `user`): onAuthStateChanged pode disparar de novo pro MESMO usuário
    // com um objeto novo (ex.: refresh de token) -- dependeria da referência recriaria o
    // listener à toa a cada vez. Só o uid realmente muda a identidade de qual carteira
    // observar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  return <WalletContext.Provider value={{ wallet, loading, error }}>{children}</WalletContext.Provider>
}
