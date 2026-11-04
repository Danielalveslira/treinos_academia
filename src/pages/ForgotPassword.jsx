import { AuthLayout } from '../components/PublicLayout'
import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { Button, FormControl, TextInput, Link, Flash, Stack } from '@primer/react'
import { resetPassword } from '../services/authService'
import { translateAuthError } from '../utils/authErrors'
import { AuthCaptcha } from '../components/AuthCaptcha'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'

const RESEND_COOLDOWN_S = 60

export default function ForgotPassword() {
  const location = useLocation()
  // Vem de Register.jsx (etapa 'locked', ver confirmSignupAndSyncPassword) quando o
  // e-mail já é conhecido -- só uma conveniência de preenchimento, nunca confiado como
  // prova de posse do e-mail (resetPassword continua exigindo o link por e-mail de novo).
  const [email, setEmail] = useState(location.state?.email || '')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const inFlight = useRef(false)
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  // Mensagem SEMPRE genérica (sucesso ou erro de validação por trás das cenas não
  // distingue "e-mail existe" de "não existe") -- só uma falha real de rede/servidor
  // mostra o erro técnico, nunca o resultado da busca pelo e-mail.
  async function handleSubmit(e) {
    e.preventDefault()
    if (inFlight.current || cooldown > 0) return
    setError('')
    inFlight.current = true
    setSubmitting(true)
    try {
      await resetPassword(email, takeCaptchaToken(captcha))
      setSent(true)
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      console.error('[Auth] resetPassword:', err)
      setError(translateAuthError(err))
    } finally {
      captcha.current?.reset()
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Recuperar senha"
      description="Informe o e-mail da sua conta para receber um link de recuperação."
      footer={
        <>
          <Link as={RouterLink} to="/login" replace>
            Voltar para entrar
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="public-form">
        <Stack gap="normal">
          {error && (
            <Flash role="alert" variant="danger">
              {error}
            </Flash>
          )}

          {sent && (
            <Flash variant="success" role="status">
              Se este e-mail tiver acesso à recuperação, um link poderá chegar em breve. Confira
              também a caixa de spam.
            </Flash>
          )}

          <FormControl required>
            <FormControl.Label>E-mail</FormControl.Label>
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              size="large"
              block
            />
          </FormControl>

          <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />

          <Button
            type="submit"
            variant="primary"
            size="large"
            block
            loading={submitting}
            disabled={submitting || cooldown > 0 || !captchaVerified}
          >
            {sent
              ? cooldown > 0
                ? `Reenviar link (${cooldown}s)`
                : 'Reenviar link'
              : 'Enviar link'}
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  )
}
