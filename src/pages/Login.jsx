import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, FormControl, TextInput, Heading, Link, Flash, Stack } from '@primer/react'
import { loginUser } from '../services/authService'
import { translateAuthError } from '../utils/authErrors'

export default function Login() {
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
      await loginUser(email, password)
      navigate('/')
    } catch (err) {
      console.error('[Auth] login:', err)
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
          Entrar
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
              autoComplete="current-password"
              block
            />
          </FormControl>

          <Button type="submit" variant="primary" block loading={submitting}>
            Entrar
          </Button>

          <Stack direction="horizontal" justify="space-between">
            <Link as={RouterLink} to="/esqueci-senha">
              Esqueci minha senha
            </Link>
            <Link as={RouterLink} to="/cadastro">
              Criar conta
            </Link>
          </Stack>

          <Link as={RouterLink} to="/planos" sx={{ textAlign: 'center', fontSize: 1 }}>
            Ver planos
          </Link>
        </Stack>
      </Box>
    </Box>
  )
}
