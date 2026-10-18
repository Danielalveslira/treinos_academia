import { AuthLayout } from '../components/PublicLayout'
import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Link, Flash, Stack, Spinner, Box } from '@primer/react'
import { verifyRecoveryToken, updatePassword, endOtherSessions } from '../services/authService'
import { translateAuthError } from '../utils/authErrors'
import { validatePasswordConfirmation } from '../utils/validators'
import { NewPasswordFields } from '../components/NewPasswordFields'

// 'checking': trocando token_hash por sessão (verifyRecoveryToken). 'ready': sessão de
// recuperação ativa, formulário de nova senha. 'invalid': link expirado/já usado/sem
// token_hash -- nunca um erro genérico de servidor, sempre com saída para pedir um novo
// link (ver recovery.html: o link aponta direto para esta rota, com token_hash próprio
// -- nenhum outro fluxo chega aqui com um token válido).
export default function ResetPassword() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
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
  }, [searchParams])

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setError('')
    const validationErrors = validatePasswordConfirmation(password, confirmPassword)
    setFieldErrors(validationErrors)
    if (Object.keys(validationErrors).length) return

    setSubmitting(true)
    try {
      await updatePassword(password)
      // Best-effort: a senha já foi trocada mesmo se isto falhar (ver endOtherSessions).
      await endOtherSessions()
      navigate('/login', { replace: true, state: { passwordResetSuccess: true } })
    } catch (err) {
      console.error('[Auth] updatePassword:', err)
      setError(translateAuthError(err))
    } finally {
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
