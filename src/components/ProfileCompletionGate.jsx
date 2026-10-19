import { useState } from 'react'
import { Button, FormControl, TextInput, Select, Flash, Stack } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { useAuth } from '../hooks/useAuth'
import { isUsernameAvailable } from '../services/usersService'
import { completeUserProfile } from '../services/profileCompletion'
import { translateAuthError } from '../utils/authErrors'
import { needsProfileCompletion } from '../utils/profileCompletion'
import {
  validateUsername,
  validateBirthDate,
  validateSexo,
  validateUsageProfile,
  hasErrors,
} from '../utils/validators'
import { UsageProfileField } from './UsageProfileField'
import { LogoutButton } from './LogoutButton'

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

// Guarda, dentro de ProtectedRoute (depois das guardas de conta bloqueada/exclusão),
// contas com sessão válida mas que nunca completaram o cadastro -- hoje só por causa do
// bug same_password já corrigido em syncSignupPassword (ver KNOWN_LIMITATIONS.md), mas
// fica como rede de segurança para qualquer outra interrupção futura entre confirmar o
// e-mail e completeUserProfile. ProtectedRoute só chega aqui com profile já carregado
// (loading/!profile tratados antes) -- needsProfileCompletion(null) devolvendo false é
// defensivo, não o mecanismo real de distinguir carregando de vazio.
export function ProfileCompletionGate({ children }) {
  const { user, profile, refreshProfile } = useAuth()
  const [username, setUsernameField] = useState('')
  const [sexo, setSexo] = useState('nao_informar')
  const [birthDate, setBirthDate] = useState('')
  const [usageProfile, setUsageProfileField] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!needsProfileCompletion(profile)) return children

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setError('')
    const validationErrors = {
      ...validateUsername(username),
      ...validateBirthDate(birthDate),
      ...validateSexo(sexo),
      ...validateUsageProfile(usageProfile),
    }
    setFieldErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      const available = await isUsernameAvailable(username)
      if (!available) {
        setFieldErrors({ username: 'Esse nome de usuário já está em uso' })
        return
      }
      await completeUserProfile(user.uid, { username, sexo, birthDate, usageProfile })
      await refreshProfile(user.uid)
    } catch (err) {
      console.error('[Auth] ProfileCompletionGate:', err)
      setError(translateAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PublicLayout>
      <section className="support-page" aria-labelledby="profile-completion-title">
        <h1 id="profile-completion-title">Complete seu cadastro</h1>
        <p>Antes de continuar, precisamos de mais algumas informações da sua conta.</p>
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
                3 a 20 caracteres: letras minúsculas, números ou _. É o que aparece nas comunidades.
              </FormControl.Caption>
              {fieldErrors.username && (
                <FormControl.Validation variant="error">
                  {fieldErrors.username}
                </FormControl.Validation>
              )}
            </FormControl>

            <FormControl required>
              <FormControl.Label>Data de nascimento</FormControl.Label>
              <TextInput
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                max={todayString()}
                size="large"
                block
              />
              {fieldErrors.birthDate && (
                <FormControl.Validation variant="error">
                  {fieldErrors.birthDate}
                </FormControl.Validation>
              )}
            </FormControl>

            <FormControl>
              <FormControl.Label>Sexo</FormControl.Label>
              <Select value={sexo} onChange={(e) => setSexo(e.target.value)} block>
                <Select.Option value="nao_informar">Não informar</Select.Option>
                <Select.Option value="masculino">Masculino</Select.Option>
                <Select.Option value="feminino">Feminino</Select.Option>
              </Select>
            </FormControl>

            <UsageProfileField
              value={usageProfile}
              onChange={setUsageProfileField}
              disabled={submitting}
            />
            {fieldErrors.usageProfile && (
              <FormControl.Validation variant="error">
                {fieldErrors.usageProfile}
              </FormControl.Validation>
            )}

            <Button
              type="submit"
              variant="primary"
              size="large"
              block
              loading={submitting}
              disabled={submitting}
            >
              Continuar
            </Button>
          </Stack>
        </form>
        <LogoutButton />
      </section>
    </PublicLayout>
  )
}
