import { useEffect, useRef, useState } from 'react'
import { Button, Flash, Spinner } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { useAuth } from '../hooks/useAuth'
import { sendVerificationEmail, refreshEmailVerified, logoutUser } from '../services/authService'

const RESEND_COOLDOWN_S = 60

export function EmailVerificationGate({ children }) {
  const { user } = useAuth()
  const [checking, setChecking] = useState(true)
  const [verified, setVerified] = useState(user.emailVerified)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // manual: true só quando vem do clique em "Já verifiquei" — aí, se ainda não estiver
  // verificado, avisamos explicitamente (em vez de deixar o botão parecer que não fez
  // nada). As checagens automáticas (montar/voltar à aba) continuam silenciosas nesse
  // caso, porque "ainda não verificado" é o estado normal na maior parte do tempo.
  async function checkStatus(manual = false) {
    setChecking(true)
    setError('')
    if (manual) setPending(false)
    try {
      const isVerified = await refreshEmailVerified(user)
      if (mounted.current) {
        setVerified(isVerified)
        if (manual && !isVerified) setPending(true)
      }
      return isVerified
    } catch {
      if (mounted.current) setError('Não foi possível checar agora. Tente novamente.')
      return false
    } finally {
      if (mounted.current) setChecking(false)
    }
  }

  // Primeira checagem ao montar (cobre reabrir o app depois de verificar em outro
  // momento) e de novo sempre que a aba volta a ficar visível (cobre verificar em
  // outra aba/dispositivo e voltar para esta sem precisar clicar em nada). Para de
  // checar sozinho assim que confirma a verificação — sem o guard, o listener ficava
  // vivo pelo resto da sessão (este componente nunca desmonta depois de liberar o
  // acesso, só passa a renderizar `children`), renovando o token à toa a cada troca de
  // aba mesmo já tendo verificado há muito tempo.
  useEffect(() => {
    if (verified) return undefined
    checkStatus()
    function onVisible() {
      if (document.visibilityState === 'visible') checkStatus()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, verified])

  // Contagem regressiva do cooldown de reenvio — só cosmética (o Auth já recusa
  // reenvios em excesso com over_email_send_rate_limit de qualquer forma); evita o
  // usuário martelar o botão e bater nesse limite sem necessidade.
  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  if (verified) return children

  async function handleResend() {
    if (resending || cooldown > 0) return
    setResending(true)
    setError('')
    setResent(false)
    setPending(false)
    try {
      await sendVerificationEmail(user)
      if (mounted.current) {
        setResent(true)
        setCooldown(RESEND_COOLDOWN_S)
      }
    } catch (err) {
      if (mounted.current) {
        setError(
          err.code === 'auth/too-many-requests'
            ? 'Muitas tentativas. Aguarde alguns minutos antes de reenviar.'
            : 'Não foi possível reenviar o e-mail agora. Tente novamente em instantes.'
        )
      }
    } finally {
      if (mounted.current) setResending(false)
    }
  }

  return (
    <PublicLayout>
      <section className="support-page" aria-labelledby="verify-email-title">
        <h1 id="verify-email-title">Confirme seu e-mail</h1>
        <p>
          Enviamos um link de confirmação para <strong>{user.email}</strong>. Abra sua caixa de
          entrada (e a pasta de spam, por garantia) e clique no link para liberar o acesso.
        </p>
        {error && (
          <Flash variant="danger" role="alert">
            {error}
          </Flash>
        )}
        {!error && pending && (
          <Flash variant="attention">
            Ainda não identificamos a verificação. Confira sua caixa de entrada (e o spam) — o
            link pode levar alguns instantes para ser processado depois do clique.
          </Flash>
        )}
        {resent && !error && !pending && (
          <Flash variant="success">E-mail reenviado para {user.email}.</Flash>
        )}
        <div className="email-verify-actions">
          <Button
            variant="primary"
            onClick={() => checkStatus(true)}
            loading={checking}
            disabled={checking}
          >
            Já verifiquei
          </Button>
          <Button onClick={handleResend} loading={resending} disabled={resending || cooldown > 0}>
            {cooldown > 0 ? `Reenviar e-mail (${cooldown}s)` : 'Reenviar e-mail'}
          </Button>
          <Button onClick={logoutUser}>Sair da conta</Button>
        </div>
      </section>
    </PublicLayout>
  )
}
