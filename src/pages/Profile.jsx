import { useState } from 'react'
import {
  Box,
  Button,
  FormControl,
  TextInput,
  Heading,
  Text,
  Flash,
  Stack,
  Label,
} from '@primer/react'
import { PersonIcon, ShieldLockIcon, CalendarIcon, MailIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { formatDate } from '../utils/format'
import { validateUsername, hasErrors } from '../utils/validators'

function toDate(value) {
  return value?.toDate ? value.toDate() : value ? new Date(value) : null
}

export default function Profile() {
  const { user, profile, isSuperAdmin, claimUsername } = useAuth()
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

  const initial = (profile?.username || user?.email || '?')[0]?.toUpperCase()
  const memberSince = formatDate(toDate(profile?.createdAt))

  return (
    <Box>
      <Heading as="h1" sx={{ fontSize: 3, mb: 3 }}>
        Meu perfil
      </Heading>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          p: 3,
          mb: 3,
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            bg: 'accent.emphasis',
            color: 'fg.onEmphasis',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 3,
            fontWeight: 'bold',
            flexShrink: 0,
          }}
        >
          {initial}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Text sx={{ fontWeight: 'bold', fontSize: 2, display: 'block' }}>
            {profile?.username ? `@${profile.username}` : 'Sem nome de usuário'}
          </Text>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, flexWrap: 'wrap' }}>
            {isSuperAdmin && (
              <Label variant="accent">
                <ShieldLockIcon size={12} /> Superadmin
              </Label>
            )}
            <Text
              sx={{ fontSize: 0, color: 'fg.muted', display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <CalendarIcon size={12} /> Membro desde {memberSince}
            </Text>
          </Box>
        </Box>
      </Box>

      <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
        Nome de usuário
      </Heading>
      <Text sx={{ color: 'fg.muted', display: 'block', mb: 2 }}>
        Aparece nas comunidades no lugar do seu e-mail. Publicações feitas antes de trocar o nome de
        usuário continuam mostrando o valor antigo (ou "Membro") até expirarem.
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
          mb: 3,
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

      <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
        Conta
      </Heading>
      <Box
        sx={{
          maxWidth: '400px',
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 3, py: 2 }}>
          <MailIcon size={16} />
          <Box sx={{ minWidth: 0 }}>
            <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block' }}>E-mail</Text>
            <Text sx={{ fontSize: 1 }}>{user?.email}</Text>
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 3,
            py: 2,
            borderTop: '1px solid',
            borderColor: 'border.default',
          }}
        >
          <PersonIcon size={16} />
          <Box sx={{ minWidth: 0 }}>
            <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block' }}>Tipo de conta</Text>
            <Text sx={{ fontSize: 1 }}>{isSuperAdmin ? 'Superadmin' : 'Usuário'}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
