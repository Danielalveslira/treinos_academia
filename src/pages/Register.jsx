import { AuthLayout } from '../components/PublicLayout'
import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Button, FormControl, TextInput, Link, Flash, Stack } from '@primer/react'
import { registerUser } from '../services/authService'
import { translateAuthError } from '../utils/authErrors'

export default function Register() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await registerUser(email, password)
      navigate('/')
    } catch (err) {
      console.error('[Auth] register:', err)
      setError(translateAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Comece sua jornada"
      description="Crie sua conta e mantenha seus treinos organizados."
      footer={
        <>
          Já tem uma conta?{' '}
          <Link as={RouterLink} to="/login">
            Entrar
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
              autoComplete="new-password"
              minLength={6}
              size="large"
              block
            />
            <FormControl.Caption>Mínimo de 6 caracteres.</FormControl.Caption>
          </FormControl>

          <Button
            type="submit"
            variant="primary"
            size="large"
            block
            loading={submitting}
            disabled={submitting}
          >
            Criar conta
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  )
}
