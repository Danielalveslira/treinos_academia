import { AuthLayout } from '../components/PublicLayout'
import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Button, Link, Flash, Stack, Spinner, Box } from '@primer/react'
import { updatePassword, revokeOtherSessionsRequired, logoutUser } from '../services/authService'
import { useRecoveryTokenExchange } from '../hooks/useRecoveryTokenExchange'
import { translateAuthError } from '../utils/authErrors'
import { validatePasswordConfirmation } from '../utils/validators'
import { NewPasswordFields } from '../components/NewPasswordFields'
import { trackAuthEvent, reportAuthOutcome } from '../utils/authAnalytics'

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
  const passwordUpdated = useRef(false)
  const othersRevoked = useRef(false)

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
    if (!passwordUpdated.current) {
      const validationErrors = validatePasswordConfirmation(password, confirmPassword)
      setFieldErrors(validationErrors)
      if (Object.keys(validationErrors).length) return
    }

    inFlight.current = true
    setSubmitting(true)
    try {
      if (!passwordUpdated.current) {
        await updatePassword(password)
        trackAuthEvent('password_changed', { flow: 'recovery' })
        passwordUpdated.current = true
        setPassword('')
        setConfirmPassword('')
      }
      if (!othersRevoked.current) {
        await revokeOtherSessionsRequired()
        othersRevoked.current = true
      }
      // A sessão criada por verifyRecoveryToken (useRecoveryTokenExchange) é de RECUPERAÇÃO, não um
      // login explícito -- sem encerrá-la aqui, Login.jsx:28 (`if (!loading && user) return <Navigate
      // to="/app" />`) redirecionaria quem chegou nesta tela direto para dentro do app, pulando o
      // "entre com sua nova senha" que a própria mensagem de sucesso promete. A troca de senha
      // já aconteceu e não pode ser desfeita por uma falha ao encerrar esta sessão.
      const { revoked } = await logoutUser()
      navigate('/login', {
        replace: true,
        state: revoked
          ? { passwordResetSuccess: true }
          : { passwordResetRevocationPending: true },
      })
    } catch (err) {
      reportAuthOutcome(err)
      if (passwordUpdated.current && !othersRevoked.current) trackAuthEvent('session_revocation_pending')
      setError(passwordUpdated.current
        ? othersRevoked.current
          ? 'A senha foi alterada, mas a saída desta sessão não foi confirmada. Tente concluir novamente.'
          : 'A senha foi alterada, mas ainda não foi possível encerrar as outras sessões. Tente concluir novamente.'
        : translateAuthError(err))
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

          {passwordUpdated.current ? <Flash role="status">Senha alterada. Conclua a proteção das sessões.</Flash> : <NewPasswordFields
            password={password}
            onPasswordChange={setPassword}
            confirmPassword={confirmPassword}
            onConfirmPasswordChange={setConfirmPassword}
            fieldErrors={fieldErrors}
          />}

          <Button
            type="submit"
            variant="primary"
            size="large"
            block
            loading={submitting}
            disabled={submitting}
          >
            {passwordUpdated.current ? 'Concluir proteção da conta' : 'Redefinir senha'}
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  )
}
