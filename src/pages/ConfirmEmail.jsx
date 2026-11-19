import { AuthLayout } from '../components/PublicLayout'
import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import { Button, FormControl, TextInput, Link, Flash, Stack } from '@primer/react'
import {
  confirmSignupOtp,
  sendVerificationEmail,
  updatePassword,
  revokeOtherSessionsRequired,
  logoutUser,
  emailFirstSignupReady,
} from '../services/authService'
import { translateAuthError } from '../utils/authErrors'
import { trackAuthEvent, reportAuthOutcome } from '../utils/authAnalytics'
import { validatePasswordConfirmation } from '../utils/validators'
import { NewPasswordFields } from '../components/NewPasswordFields'
import { AuthCaptcha } from '../components/AuthCaptcha'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'

const RESEND_COOLDOWN_S = 60

// Rota avulsa para quem fechou a aba antes de digitar o código no cadastro (Register.jsx
// trata o caso "ainda na mesma aba" inline, sem navegar para cá) ou tentou entrar com um
// e-mail nunca confirmado (ver Login.jsx, erro email_not_confirmed). Ao contrário do Register,
// aqui NENHUMA senha é conhecida de antemão -- quem está confirmando pode ser a vítima de um
// pre-account hijacking (alguém se cadastrou primeiro com este e-mail e uma senha própria; ver
// nota em authService.js/syncSignupPassword). Por isso, depois do código, exige definir uma
// senha nova (reaproveitando a etapa de ResetPassword.jsx) antes de liberar qualquer acesso --
// nunca herda a senha que já estava na conta.
export default function ConfirmEmail() {
  const navigate = useNavigate()
  const location = useLocation()
  const [step, setStep] = useState('otp')
  const [emailFirstReady, setEmailFirstReady] = useState(null)
  const [email, setEmail] = useState(location.state?.email || '')
  const [otpCode, setOtpCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const mounted = useRef(true)
  const submitInFlight = useRef(false)
  const resendInFlight = useRef(false)
  const passwordUpdated = useRef(false)
  const othersRevoked = useRef(false)
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let active = true
    emailFirstSignupReady()
      .then((ready) => { if (active) setEmailFirstReady(ready) })
      .catch(() => { if (active) setEmailFirstReady('unavailable') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  async function handleOtpSubmit(e) {
    e.preventDefault()
    if (emailFirstReady !== false) return
    if (
      submitInFlight.current ||
      resendInFlight.current ||
      !email.trim() ||
      otpCode.trim().length !== 6
    )
      return
    setError('')
    submitInFlight.current = true
    setSubmitting(true)
    try {
      await confirmSignupOtp(email.trim(), otpCode.trim())
      trackAuthEvent('otp_verified', { flow: 'standalone' })
      if (mounted.current) setStep('password')
    } catch (err) {
      reportAuthOutcome(err)
      console.error('[Auth] confirmSignupOtp:', err)
      setError(translateAuthError(err))
    } finally {
      submitInFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    if (submitInFlight.current) return
    setError('')
    if (!passwordUpdated.current) {
      const validationErrors = validatePasswordConfirmation(password, confirmPassword)
      setFieldErrors(validationErrors)
      if (Object.keys(validationErrors).length) return
    }

    submitInFlight.current = true
    setSubmitting(true)
    try {
      if (!passwordUpdated.current) {
        await updatePassword(password)
        passwordUpdated.current = true
        setPassword('')
        setConfirmPassword('')
        trackAuthEvent('password_changed', { flow: 'standalone' })
      }
      if (!othersRevoked.current) {
        await revokeOtherSessionsRequired()
        othersRevoked.current = true
      }
      const { revoked } = await logoutUser()
      navigate('/login', {
        replace: true,
        state: revoked
          ? { passwordResetSuccess: true }
          : { passwordResetRevocationPending: true },
      })
    } catch (err) {
      reportAuthOutcome(err)
      if (passwordUpdated.current && !othersRevoked.current)
        trackAuthEvent('session_revocation_pending')
      if (mounted.current)
        setError(
          passwordUpdated.current
            ? othersRevoked.current
              ? 'A senha foi alterada, mas a saída desta sessão não foi confirmada. Tente concluir novamente.'
              : 'A senha foi alterada, mas ainda não foi possível encerrar as outras sessões. Tente concluir novamente.'
            : translateAuthError(err)
        )
    } finally {
      submitInFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
  }

  async function handleResend() {
    if (emailFirstReady !== false) return
    if (submitInFlight.current || resendInFlight.current || cooldown > 0 || !email.trim()) return
    resendInFlight.current = true
    setResending(true)
    setError('')
    setResent(false)
    try {
      await sendVerificationEmail(email.trim(), takeCaptchaToken(captcha))
      if (mounted.current) {
        setResent(true)
        setCooldown(RESEND_COOLDOWN_S)
      }
    } catch (err) {
      reportAuthOutcome(err)
      console.error('[Auth] sendVerificationEmail:', err)
      if (mounted.current) setError(translateAuthError(err))
    } finally {
      captcha.current?.reset()
      resendInFlight.current = false
      if (mounted.current) setResending(false)
    }
  }

  if (emailFirstReady === true) {
    return (
      <AuthLayout title="Continue seu cadastro" description="Solicite um código novo para concluir o cadastro com segurança.">
        <Button as={RouterLink} to="/cadastro" state={{ email }} variant="primary" size="large" block>
          Continuar cadastro
        </Button>
      </AuthLayout>
    )
  }

  if (emailFirstReady === 'unavailable') {
    return <AuthLayout title="Confirmação indisponível" description="Não foi possível confirmar a configuração do cadastro. Tente novamente mais tarde." />
  }

  if (emailFirstReady !== false) {
    return <AuthLayout title="Preparando confirmação" description="Aguarde um instante." />
  }

  if (step === 'password') {
    return (
      <AuthLayout
        title="Defina uma senha para sua conta"
        description="Por segurança, defina uma senha nova antes de continuar."
        footer={
          <Link as={RouterLink} to="/login" replace>
            Voltar para entrar
          </Link>
        }
      >
        <form onSubmit={handlePasswordSubmit} className="public-form">
          <Stack gap="normal">
            {error && (
              <Flash role="alert" variant="danger">
                {error}
              </Flash>
            )}

            {passwordUpdated.current ? (
              <Flash role="status">Senha alterada. Conclua a proteção das sessões.</Flash>
            ) : (
              <NewPasswordFields
                password={password}
                onPasswordChange={setPassword}
                confirmPassword={confirmPassword}
                onConfirmPasswordChange={setConfirmPassword}
                fieldErrors={fieldErrors}
              />
            )}

            <Button
              type="submit"
              variant="primary"
              size="large"
              block
              loading={submitting}
              disabled={submitting}
            >
              {passwordUpdated.current ? 'Concluir proteção da conta' : 'Definir senha'}
            </Button>
          </Stack>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Confirme seu e-mail"
      description="Se houver uma confirmação pendente para este e-mail, digite o código recebido para continuar."
      footer={
        // Texto neutro de propósito (mesma razão do Register.jsx) -- nem confirma nem
        // nega que já existe uma conta com este e-mail.
        <>
          Já tem uma conta?{' '}
          <Link as={RouterLink} to="/login" replace>
            Entre
          </Link>{' '}
          ou{' '}
          <Link as={RouterLink} to="/esqueci-senha" state={{ email }} replace>
            recupere sua senha
          </Link>
          .
        </>
      }
    >
      <form onSubmit={handleOtpSubmit} className="public-form">
        <Stack gap="normal">
          {error && (
            <Flash role="alert" variant="danger">
              {error}
            </Flash>
          )}
          {resent && !error && (
            <Flash variant="success" role="status">
              Solicitação de reenvio recebida. Se houver confirmação pendente, confira seu e-mail.
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

          <FormControl required>
            <FormControl.Label>Código de confirmação</FormControl.Label>
            <TextInput
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              size="large"
              block
            />
            <FormControl.Caption>Confira também a caixa de spam.</FormControl.Caption>
          </FormControl>

          <Button
            type="submit"
            variant="primary"
            size="large"
            block
            loading={submitting}
            disabled={submitting || resending || !email.trim() || otpCode.trim().length !== 6}
          >
            Confirmar
          </Button>
          {/* O GoTrue não aceita CAPTCHA em verifyOtp (campo depreciado no SDK); a defesa
              dessa chamada é o rate limit nativo de tentativas de verificação, não o widget
              abaixo. O CAPTCHA aqui protege só o reenvio -- por isso fica preso a ele, não ao
              Confirmar acima. */}
          <p>Verificação de segurança necessária para reenviar o código:</p>
          <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
          <Button
            type="button"
            block
            onClick={handleResend}
            loading={resending}
            disabled={submitting || resending || cooldown > 0 || !email.trim() || !captchaVerified}
          >
            {cooldown > 0 ? `Reenviar código (${cooldown}s)` : 'Reenviar código'}
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  )
}
