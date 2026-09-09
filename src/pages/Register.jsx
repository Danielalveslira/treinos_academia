import { AuthLayout } from '../components/PublicLayout'
import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Button, FormControl, TextInput, Link, Flash, Stack } from '@primer/react'
import { registerUser } from '../services/authService'
import { ensureUserProfile, setUsername, isUsernameAvailable } from '../services/usersService'
import { initializeTrial } from '../services/billingService'
import { useAuth } from '../hooks/useAuth'
import { translateAuthError } from '../utils/authErrors'
import { validateUsername, hasErrors } from '../utils/validators'
import { LegalConsent } from '../components/LegalConsent'
import { LEGAL_MANIFEST } from '../utils/legal'
import { acceptLegalDocuments } from '../services/legalService'

export default function Register() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsernameField] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdAccount, setCreatedAccount] = useState(null)
  const [confirmed, setConfirmed] = useState({
    accepted: false,
    healthDataConsent: false,
    ageConfirmed: false,
  })

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (LEGAL_MANIFEST.published && !Object.values(confirmed).every(Boolean)) {
      setError('Confirme os documentos, a autorização para seus dados de treino e a idade mínima.')
      return
    }

    const validationErrors = validateUsername(username)
    setFieldErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      if (createdAccount) {
        await initializeTrial()
        await acceptLegalDocuments(confirmed)
        await refreshProfile(createdAccount)
        navigate('/')
        return
      }
      // Valida o @ antes de criar a conta no Authentication: assim uma tentativa
      // inválida nunca chega a existir como conta órfã.
      const available = await isUsernameAvailable(username)
      if (!available) {
        setFieldErrors({ username: 'Esse nome de usuário já está em uso' })
        return
      }

      const credential = await registerUser(email, password)
      const uid = credential.user.uid
      try {
        await ensureUserProfile(uid)
        await setUsername(uid, username)
      } catch (postCreateErr) {
        // A conta no Authentication já existe nesse ponto: sem isso o e-mail ficaria
        // órfão e bloqueado para novas tentativas. Desfaz para deixar o e-mail livre.
        await credential.user.delete().catch((cleanupErr) => {
          console.error('[Auth] register rollback failed:', cleanupErr)
        })
        if (postCreateErr.message === 'USERNAME_TAKEN') {
          setFieldErrors({ username: 'Esse nome de usuário já está em uso' })
          return
        }
        throw postCreateErr
      }
      setCreatedAccount(uid)
      await initializeTrial()
      if (LEGAL_MANIFEST.published) await acceptLegalDocuments(confirmed)
      await refreshProfile(uid)
      navigate('/')
    } catch (err) {
      console.error('[Auth] register:', err)
      setError(
        err.code?.startsWith('functions/')
          ? 'Sua conta foi criada, mas o aceite não foi registrado. Tente novamente ou entre na conta para concluir.'
          : translateAuthError(err)
      )
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
              3 a 20 caracteres: letras minúsculas, números ou _. É o que aparece nas comunidades.
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

          {LEGAL_MANIFEST.published && (
            <LegalConsent value={confirmed} onChange={setConfirmed} disabled={submitting} />
          )}

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
