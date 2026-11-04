import { AuthLayout } from '../components/PublicLayout'
import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import { Button, FormControl, TextInput, Link, Flash, Stack } from '@primer/react'
import {
  confirmSignupOtp,
  sendVerificationEmail,
  setPasswordAfterConfirmation,
} from '../services/authService'
import { translateAuthError } from '../utils/authErrors'
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
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  async function handleOtpSubmit(e) {
    e.preventDefault()
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
      if (mounted.current) setStep('password')
    } catch (err) {
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
    const validationErrors = validatePasswordConfirmation(password, confirmPassword)
    setFieldErrors(validationErrors)
    if (Object.keys(validationErrors).length) return

    submitInFlight.current = true
    setSubmitting(true)
    try {
      await setPasswordAfterConfirmation(password)
      navigate('/login', { replace: true, state: { passwordResetSuccess: true } })
    } catch (err) {
      console.error('[Auth] setPasswordAfterConfirmation:', err)
      if (mounted.current) setError(translateAuthError(err))
    } finally {
      submitInFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
  }

  async function handleResend() {
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
      console.error('[Auth] sendVerificationEmail:', err)
      if (mounted.current) setError(translateAuthError(err))
    } finally {
      captcha.current?.reset()
      resendInFlight.current = false
      if (mounted.current) setResending(false)
    }
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

            <NewPasswordFields
              password={password}
              onPasswordChange={setPassword}
              confirmPassword={confirmPassword}
              onConfirmPasswordChange={setConfirmPassword}
              fieldErrors={fieldErrors}
            />

            <Button
              type="submit"
              variant="primary"
              size="large"
              block
              loading={submitting}
              disabled={submitting}
            >
              Definir senha
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
