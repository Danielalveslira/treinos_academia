import { useContext } from 'react'
import { WalletContext } from '../contexts/WalletContext'

// Consome a MESMA carteira compartilhada de WalletContext.jsx (1 onSnapshot por
// usuário, nunca um listener por componente) -- Header, EvoCash, CreateCommunity,
// PromoteDialog e qualquer tela futura usam este hook e sempre veem o mesmo estado, ao
// vivo. Nenhum refresh() manual: o listener já mantém a carteira atualizada sozinho, sem
// exceção (inclusive mudanças feitas por outra sessão/admin).
export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) throw new Error('useWallet deve ser usado dentro de WalletProvider')
  return context
}
