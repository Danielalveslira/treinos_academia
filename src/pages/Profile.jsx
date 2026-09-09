import { useState } from 'react'
import { Box, Button, FormControl, TextInput, Heading, Text, Flash, Stack } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { validateUsername, hasErrors } from '../utils/validators'

export default function Profile() {
  const { profile, claimUsername } = useAuth()
  const [username, setUsername] = useState(profile?.username || '')
  const [fieldErrors, setFieldErrors] = useState({})
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSuccess(false)

    const validationErrors = validateUsername(username)
    setFieldErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      await claimUsername(username)
      setSuccess(true)
    } catch (err) {
      if (err.message === 'USERNAME_TAKEN') {
        setFieldErrors({ username: 'Esse nome de usuário já está em uso' })
      } else {
        console.error('[Profile] setUsername:', err)
        setFieldErrors({ username: 'Não foi possível salvar. Tente novamente.' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box>
      <Heading as="h1" sx={{ fontSize: 3, mb: 1 }}>
        Meu perfil
      </Heading>
      <Text sx={{ color: 'fg.muted', display: 'block', mb: 3 }}>
        Seu nome de usuário aparece nas comunidades, no lugar do seu e-mail.
      </Text>

      <Box
        as="form"
        onSubmit={handleSubmit}
        sx={{
          maxWidth: '400px',
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          p: 3,
        }}
      >
        <Stack gap="condensed">
          {success && <Flash variant="success">Nome de usuário salvo.</Flash>}

          <FormControl required>
            <FormControl.Label>Nome de usuário</FormControl.Label>
            <TextInput
              leadingVisual="@"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="seu_usuario"
              autoComplete="username"
              block
            />
            <FormControl.Caption>
              3 a 20 caracteres: letras minúsculas, números ou _.
            </FormControl.Caption>
            {fieldErrors.username && (
              <FormControl.Validation variant="error">
                {fieldErrors.username}
              </FormControl.Validation>
            )}
          </FormControl>

          <Button type="submit" variant="primary" loading={submitting} sx={{ alignSelf: 'start' }}>
            Salvar
          </Button>
        </Stack>
      </Box>
    </Box>
  )
}
