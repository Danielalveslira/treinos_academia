import { useRef, useState } from 'react'
import { Button, FormControl, TextInput, Select, Flash, Stack } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { useAuth } from '../hooks/useAuth'
import { isUsernameAvailable } from '../services/usersService'
import { completeUserProfile } from '../services/profileCompletion'
import { describeRegistrationError } from '../utils/registrationErrors'
import {
  validateUsername,
  validateBirthDate,
  validateSexo,
  validateUsageProfile,
  validateResidenceMunicipality,
  hasErrors,
  SEXO_OPTIONS,
} from '../utils/validators'
import { USAGE_PROFILES } from '../constants/usageProfile'
import { UsageProfileField } from './UsageProfileField'
import { CitySelector } from './CitySelector'
import { MINIMUM_REGISTRATION_AGE } from '../constants/accountAge'
import { LogoutButton } from './LogoutButton'

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

// Formulário de conclusão de cadastro (carregado sob demanda por ProfileCompletionGate).
export default function ProfileCompletionForm() {
  const { user, profile, refreshProfile } = useAuth()
  // Retomada: o que uma tentativa anterior JÁ gravou (nascimento, sexo, cidade, perfil de uso) vem
  // preenchido -- a pessoa só completa o que falta, sem redigitar. Só é lido na montagem; depois, o
  // que vale é o que está no formulário.
  const [username, setUsernameField] = useState('')
  const [sexo, setSexo] = useState(() => (SEXO_OPTIONS.includes(profile?.sexo) ? profile.sexo : ''))
  const [birthDate, setBirthDate] = useState(() => profile?.dataNascimento?.slice?.(0, 10) || '')
  const [cityCode, setCityCode] = useState(() => profile?.residenceMunicipalityCode ?? null)
  // usage_profile nasce 'common' no banco (default da coluna), então só um valor diferente prova que
  // a pessoa já escolheu; 'common' continua exigindo escolha explícita, como no cadastro.
  const [usageProfile, setUsageProfileField] = useState(() =>
    USAGE_PROFILES.includes(profile?.usageProfile) && profile.usageProfile !== 'common'
      ? profile.usageProfile
      : ''
  )
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)

  function clearFieldError(field) {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (inFlight.current) return
    setError('')
    const validationErrors = {
      ...validateUsername(username),
      ...validateBirthDate(birthDate, { minimumAge: MINIMUM_REGISTRATION_AGE }),
      ...validateResidenceMunicipality(cityCode),
      ...validateSexo(sexo, { required: true }),
      ...validateUsageProfile(usageProfile),
    }
    setFieldErrors(validationErrors)
    if (hasErrors(validationErrors)) {
      setError('Revise os campos destacados.')
      return
    }

    inFlight.current = true
    setSubmitting(true)
    try {
      const available = await isUsernameAvailable(username)
      if (!available) {
        setFieldErrors({ username: 'Esse nome de usuário já está em uso' })
        return
      }
      await completeUserProfile(user.uid, {
        username,
        sexo,
        birthDate,
        usageProfile,
        residenceMunicipalityCode: cityCode,
      })
      await refreshProfile(user.uid)
    } catch (err) {
      console.error('[Auth] ProfileCompletionGate:', err)
      const described = describeRegistrationError(err)
      if (described.field) setFieldErrors({ [described.field]: described.message })
      setError(described.message)
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <PublicLayout>
      <section className="support-page" aria-labelledby="profile-completion-title">
        <h1 id="profile-completion-title">Complete seu cadastro</h1>
        <p>Antes de continuar, precisamos de mais algumas informações da sua conta.</p>
        <form onSubmit={handleSubmit} className="public-form" noValidate>
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
                onChange={(e) => {
                  setUsernameField(e.target.value)
                  clearFieldError('username')
                }}
                placeholder="seu_usuario"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={20}
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
                onChange={(e) => {
                  setBirthDate(e.target.value)
                  clearFieldError('birthDate')
                }}
                max={todayString()}
                size="large"
                block
              />
              <FormControl.Caption>Cadastro disponível somente para pessoas com 18 anos completos ou mais.</FormControl.Caption>
              {fieldErrors.birthDate && (
                <FormControl.Validation variant="error">
                  {fieldErrors.birthDate}
                </FormControl.Validation>
              )}
            </FormControl>

            <CitySelector
              value={cityCode}
              onChange={(code) => {
                setCityCode(code)
                clearFieldError('city')
              }}
              error={fieldErrors.city}
              disabled={submitting}
            />

            <FormControl required>
              <FormControl.Label>Sexo</FormControl.Label>
              <Select
                value={sexo}
                onChange={(e) => {
                  setSexo(e.target.value)
                  clearFieldError('sexo')
                }}
                block
              >
                <Select.Option value="" disabled>
                  Selecione uma opção
                </Select.Option>
                <Select.Option value="nao_informar">Não informar</Select.Option>
                <Select.Option value="masculino">Masculino</Select.Option>
                <Select.Option value="feminino">Feminino</Select.Option>
              </Select>
              {fieldErrors.sexo && (
                <FormControl.Validation variant="error">{fieldErrors.sexo}</FormControl.Validation>
              )}
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
