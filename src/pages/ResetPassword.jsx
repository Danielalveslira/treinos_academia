import { AuthLayout } from '../components/PublicLayout'
import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Button, Link, Flash, Stack, Spinner, Box } from '@primer/react'
import { updatePassword, endOtherSessions, logoutUser } from '../services/authService'
import { useRecoveryTokenExchange } from '../hooks/useRecoveryTokenExchange'
import { translateAuthError } from '../utils/authErrors'
import { validatePasswordConfirmation } from '../utils/validators'
import { NewPasswordFields } from '../components/NewPasswordFields'

export default function ResetPassword() {
  const navigate = useNavigate()
  const status = useRecoveryTokenExchange()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const mounted = useRef(true)
  const inFlight = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (inFlight.current) return
    setError('')
    const validationErrors = validatePasswordConfirmation(password, confirmPassword)
    setFieldErrors(validationErrors)
    if (Object.keys(validationErrors).length) return

    inFlight.current = true
    setSubmitting(true)
    try {
      await updatePassword(password)
      // Best-effort: a senha já foi trocada mesmo se isto falhar (ver endOtherSessions).
      await endOtherSessions()
      // A sessão criada por verifyRecoveryToken (useRecoveryTokenExchange) é de RECUPERAÇÃO, não um
      // login explícito -- sem encerrá-la aqui, Login.jsx:28 (`if (!loading && user) return <Navigate
      // to="/app" />`) redirecionaria quem chegou nesta tela direto para dentro do app, pulando o
      // "entre com sua nova senha" que a própria mensagem de sucesso promete (mesmo padrão de
      // setPasswordAfterConfirmation para o ConfirmEmail). Best-effort: a troca de senha já aconteceu
      // e não pode ser desfeita por uma falha ao encerrar esta sessão.
      await logoutUser().catch(() => {})
      navigate('/login', { replace: true, state: { passwordResetSuccess: true } })
    } catch (err) {
      console.error('[Auth] updatePassword:', err)
      setError(translateAuthError(err))
    } finally {
      inFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
  }

  if (status === 'checking') {
    return (
      <AuthLayout title="Redefinir senha" description="Verificando o link...">
        <Box sx={{ display: 'flex', justifyContent: 'center', padding: 4 }}>
          <Spinner />
        </Box>
      </AuthLayout>
    )
  }

  if (status === 'invalid') {
    return (
      <AuthLayout
        title="Link inválido ou expirado"
        description="Este link de redefinição de senha não é mais válido. Solicite um novo."
        footer={
          <Link as={RouterLink} to="/login" replace>
            Voltar para entrar
          </Link>
        }
      >
        <Stack gap="normal">
          <Button as={RouterLink} to="/esqueci-senha" variant="primary" size="large" block>
            Solicitar novo link
          </Button>
        </Stack>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Defina sua nova senha"
      description="Escolha uma nova senha para sua conta."
      footer={
        <Link as={RouterLink} to="/login" replace>
          Voltar para entrar
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="public-form">
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
            Redefinir senha
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  )
}
