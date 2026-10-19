import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { verifyRecoveryToken } from '../services/authService'

// 'checking': trocando token_hash por sessão (verifyRecoveryToken). 'ready': sessão de
// recuperação ativa. 'invalid': link expirado/já usado/sem token_hash -- ver ResetPassword.jsx,
// único chamador (ver recovery.html: o link aponta direto para /redefinir-senha, com
// token_hash próprio -- nenhum outro fluxo chega aqui com um token válido).
//
// A query (token_hash/type) é limpa da URL IMEDIATAMENTE, antes do resultado do verifyOtp --
// já foi lida para a variável local tokenHash, que é o que verifyRecoveryToken usa a seguir;
// não precisa continuar na barra de endereço, no histórico do navegador nem no Referer de
// requisições futuras desta aba enquanto a pessoa ainda define a senha nova.
export function useRecoveryTokenExchange() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState('checking')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type')
    setSearchParams({}, { replace: true })
    if (!tokenHash || type !== 'recovery') {
      setStatus('invalid')
      return
    }
    verifyRecoveryToken(tokenHash)
      .then(() => {
        if (mounted.current) setStatus('ready')
      })
      .catch((err) => {
        console.error('[Auth] verifyRecoveryToken:', err)
        if (mounted.current) setStatus('invalid')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intencional: só a leitura inicial da URL interessa (ver comentário acima), e setSearchParams já limpou a query nesta mesma rodada
  }, [])

  return status
}
