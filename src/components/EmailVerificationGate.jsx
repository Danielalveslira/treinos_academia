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

  async function checkStatus() {
    setChecking(true)
    setError('')
    try {
      const isVerified = await refreshEmailVerified(user)
      if (mounted.current) setVerified(isVerified)
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
  // outra aba/dispositivo e voltar para esta sem precisar clicar em nada).
  useEffect(() => {
    checkStatus()
    function onVisible() {
      if (document.visibilityState === 'visible') checkStatus()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Contagem regressiva do cooldown de reenvio — só cosmética (o Firebase já recusa
  // reenvios em excesso com auth/too-many-requests de qualquer forma); evita o usuário
  // martelar o botão e bater nesse limite sem necessidade.
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
        {resent && !error && (
          <Flash variant="success">E-mail reenviado para {user.email}.</Flash>
        )}
        <div className="email-verify-actions">
          <Button variant="primary" onClick={checkStatus} loading={checking} disabled={checking}>
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
