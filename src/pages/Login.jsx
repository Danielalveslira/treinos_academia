import { AuthLayout } from '../components/PublicLayout'
import { useState } from 'react'
import { Link as RouterLink, useNavigate, Navigate } from 'react-router-dom'
import { Button, FormControl, TextInput, Link, Flash, Stack } from '@primer/react'
import { loginUser } from '../services/authService'
import { translateAuthError } from '../utils/authErrors'
import { useAuth } from '../hooks/useAuth'

export default function Login() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await loginUser(email, password)
      // replace: a tela de login não deve continuar no histórico depois de autenticado —
      // sem isso, o botão voltar reabre /login, que se redireciona de volta pra "/" (linha
      // acima), exigindo dois toques do voltar para sair de fato da tela de login.
      navigate('/', { replace: true })
    } catch (err) {
      console.error('[Auth] login:', err)
      setError(translateAuthError(err))
    } finally {
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
      <form onSubmit={handleSubmit} className="public-form">
        <Stack gap="normal">
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

          <Button
            type="submit"
            variant="primary"
            size="large"
            block
            loading={submitting}
            disabled={submitting}
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
