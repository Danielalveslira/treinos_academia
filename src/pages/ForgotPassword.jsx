import { AuthLayout } from '../components/PublicLayout'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Button, FormControl, TextInput, Link, Flash, Stack } from '@primer/react'
import { resetPassword } from '../services/authService'
import { translateAuthError } from '../utils/authErrors'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (err) {
      console.error('[Auth] resetPassword:', err)
      setError(translateAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Recuperar senha"
      description="Informe o e-mail da sua conta para receber um link de recuperação."
      footer={
        <>
          <Link as={RouterLink} to="/login">
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

          {sent ? (
            <Flash variant="success" role="status">
              Se o e-mail existir, enviamos um link de recuperação. Confira também a caixa de spam.
            </Flash>
          ) : (
            <>
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

              <Button
                type="submit"
                variant="primary"
                size="large"
                block
                loading={submitting}
                disabled={submitting}
              >
                Enviar link
              </Button>
            </>
          )}
        </Stack>
      </form>
    </AuthLayout>
  )
}
