import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, FormControl, TextInput, Heading, Link, Flash, Stack } from '@primer/react'
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
          Criar conta
        </Heading>

        <Stack gap="condensed">
          {error && <Flash variant="danger">{error}</Flash>}

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

          <FormControl required>
            <FormControl.Label>Senha</FormControl.Label>
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              block
            />
            <FormControl.Caption>Mínimo de 6 caracteres.</FormControl.Caption>
          </FormControl>

          <Button type="submit" variant="primary" block loading={submitting}>
            Criar conta
          </Button>

          <Link as={RouterLink} to="/login">
            Já tenho conta
          </Link>
        </Stack>
      </Box>
    </Box>
  )
}
