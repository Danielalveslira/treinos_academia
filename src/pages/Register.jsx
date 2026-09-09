import { AuthLayout } from '../components/PublicLayout'
import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Button, FormControl, TextInput, Link, Flash, Stack } from '@primer/react'
import { registerUser } from '../services/authService'
import { ensureUserProfile, setUsername } from '../services/usersService'
import { useAuth } from '../hooks/useAuth'
import { translateAuthError } from '../utils/authErrors'
import { validateUsername, hasErrors } from '../utils/validators'

export default function Register() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsernameField] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const validationErrors = validateUsername(username)
    setFieldErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      const credential = await registerUser(email, password)
      const uid = credential.user.uid
      await ensureUserProfile(uid)
      try {
        await setUsername(uid, username)
      } catch (usernameErr) {
        if (usernameErr.message === 'USERNAME_TAKEN') {
          setFieldErrors({ username: 'Esse nome de usuário já está em uso' })
          setSubmitting(false)
          return
        }
        throw usernameErr
      }
      await refreshProfile(uid)
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
            <FormControl.Label>Nome de usuário</FormControl.Label>
            <TextInput
              leadingVisual="@"
              value={username}
              onChange={(e) => setUsernameField(e.target.value)}
              placeholder="seu_usuario"
              autoComplete="username"
              size="large"
              block
            />
            <FormControl.Caption>
              3 a 20 caracteres: letras minúsculas, números ou _. É o que aparece nas comunidades —
              nunca seu e-mail.
            </FormControl.Caption>
            {fieldErrors.username && (
              <FormControl.Validation variant="error">
                {fieldErrors.username}
              </FormControl.Validation>
            )}
          </FormControl>

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
