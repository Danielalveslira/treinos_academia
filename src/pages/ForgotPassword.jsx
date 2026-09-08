import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Button,
  FormControl,
  TextInput,
  Heading,
  Link,
  Flash,
  Text,
  Stack,
} from '@primer/react'
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
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
      }}
    >
      <Box
        as="form"
        onSubmit={handleSubmit}
        sx={{
          width: '100%',
          maxWidth: '360px',
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          p: 4,
        }}
      >
        <Heading as="h1" sx={{ fontSize: 4, mb: 3 }}>
          Recuperar senha
        </Heading>

        <Stack gap="condensed">
          {error && <Flash variant="danger">{error}</Flash>}

          {sent ? (
            <Text>Se o e-mail existir, enviamos um link de recuperação.</Text>
          ) : (
            <>
              <FormControl required>
                <FormControl.Label>E-mail</FormControl.Label>
                <TextInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  block
                />
              </FormControl>

              <Button type="submit" variant="primary" block loading={submitting}>
                Enviar link
              </Button>
            </>
          )}

          <Link as={RouterLink} to="/login">
            Voltar ao login
          </Link>
        </Stack>
      </Box>
    </Box>
  )
}
