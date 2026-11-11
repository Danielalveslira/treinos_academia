import { AuthLayout } from '../components/PublicLayout'
import { lazy, Suspense, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Button, FormControl, TextInput, Link, Flash, Stack } from '@primer/react'
import { loginUser } from '../services/authService'
import { translateAuthError } from '../utils/authErrors'
import { consumeLogoutReason } from '../utils/logoutReason'
import { useAuth } from '../hooks/useAuth'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { OFFLINE_ENTRY_REQUIRES_INTERNET } from '../contexts/AuthContext'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'

// Carregado só a partir do 1º foco no formulário: evita baixar o script/iframes do
// hCaptcha (ver medição de performance de /login) antes de o visitante começar a entrar.
const AuthCaptcha = lazy(() =>
  import('../components/AuthCaptcha').then((m) => ({ default: m.AuthCaptcha }))
)

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading } = useAuth()
  const online = useOnlineStatus()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)
  const [formTouched, setFormTouched] = useState(false)
  // Lazy: lê e já limpa na primeira renderização -- uma sessão encerrada por
  // handlePossibleGhostSession (ver AuthContext.jsx) cai direto aqui.
  const [sessionNotice] = useState(consumeLogoutReason)
  // Vem de ResetPassword.jsx (navigate state, não sessionStorage: é só esta
  // navegação, não "a próxima tela de login" como consumeLogoutReason).
  const passwordResetSuccess = Boolean(location.state?.passwordResetSuccess)

  const advertiserReturn = location.state?.advertiserReturnTo
  const returnTo =
    typeof advertiserReturn === 'string' && /^\/meus-anuncios(?:\?|$)/.test(advertiserReturn)
      ? advertiserReturn
      : '/app'
  if (!loading && user) return <Navigate to={returnTo} replace />

  async function handleSubmit(e) {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setError('')
    setSubmitting(true)
    try {
      await loginUser(email, password, takeCaptchaToken(captcha))
      // replace: a tela de login não deve continuar no histórico depois de autenticado —
      // sem isso, o botão voltar reabre /login, que se redireciona de volta pra "/" (linha
      // acima), exigindo dois toques do voltar para sair de fato da tela de login.
      navigate(returnTo, { replace: true })
    } catch (err) {
      console.error('[Auth] login:', err)
      if (err?.code === 'email_not_confirmed') {
        // Conta criada mas nunca confirmada (ex.: fechou a aba antes de digitar o
        // código no cadastro). Sem sessão não há como mostrar nada dentro do app --
        // /confirmar-email é a mesma etapa de código do Register, só que avulsa.
        navigate('/confirmar-email', { state: { email } })
        return
      }
      setError(translateAuthError(err))
    } finally {
      captcha.current?.reset()
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Boas-vindas de volta"
      description="Entre na sua conta para continuar acompanhando sua evolução."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link as={RouterLink} to="/cadastro" replace>
            Criar conta
          </Link>
        </>
      }
    >
      <form
        onSubmit={handleSubmit}
        onFocus={() => setFormTouched(true)}
        className="public-form"
      >
        <Stack gap="normal">
          {!online && (
            // Entrar (e criar conta) exige o servidor; só quem já entrou online neste aparelho abre offline.
            <Flash role="status">{OFFLINE_ENTRY_REQUIRES_INTERNET}</Flash>
          )}
          {sessionNotice && !error && (
            <Flash
              role="status"
              variant={sessionNotice.tone === 'warning' ? 'warning' : 'default'}
              // Avisos de severidade padrão (ex.: "Você saiu da conta") são só uma confirmação, não um
              // alerta -- um Flash compacto evita que disputem espaço visual com o formulário abaixo.
              className={sessionNotice.tone === 'warning' ? undefined : 'auth-session-notice'}
            >
              {sessionNotice.message}
            </Flash>
          )}
          {passwordResetSuccess && !error && (
            <Flash role="status" variant="success">
              Senha redefinida. Entre com sua nova senha.
            </Flash>
          )}
          {error && (
            <Flash role="alert" variant="danger">
              {error}
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
            <FormControl.Label>Senha</FormControl.Label>
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              size="large"
              block
            />
          </FormControl>

          {authCaptchaRequired && !formTouched && (
            <div className="auth-captcha-placeholder" role="group" aria-label="Verificação de segurança">
              <p>A verificação de segurança aparece ao preencher o formulário.</p>
            </div>
          )}
          {(formTouched || !authCaptchaRequired) && (
            <Suspense fallback={null}>
              <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
            </Suspense>
          )}

          <Button
            type="submit"
            variant="primary"
            size="large"
            block
            loading={submitting}
            disabled={submitting || !captchaVerified}
          >
            Entrar
          </Button>

          <Link as={RouterLink} to="/esqueci-senha" className="auth-recovery" replace>
            Esqueci minha senha
          </Link>
        </Stack>
      </form>
    </AuthLayout>
  )
}
