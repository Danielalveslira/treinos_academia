import { AuthLayout } from '../components/PublicLayout'
import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Button, FormControl, TextInput, Select, Link, Flash, Stack } from '@primer/react'
import { registerUser } from '../services/authService'
import {
  ensureUserProfile,
  setUsername,
  setBirthInfo,
  isUsernameAvailable,
  deleteFreshProfile,
} from '../services/usersService'
import { useAuth } from '../hooks/useAuth'
import { translateAuthError } from '../utils/authErrors'
import { validateUsername, validateBirthDate, validateSexo, hasErrors } from '../utils/validators'
import { LegalConsent } from '../components/LegalConsent'
import { LEGAL_MANIFEST } from '../utils/legal'
import { acceptLegalDocuments } from '../services/legalService'

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

export default function Register() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsernameField] = useState('')
  const [sexo, setSexo] = useState('nao_informar')
  const [birthDate, setBirthDate] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdAccount, setCreatedAccount] = useState(null)
  const [confirmed, setConfirmed] = useState({
    accepted: false,
    healthDataConsent: false,
  })

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (LEGAL_MANIFEST.published && !Object.values(confirmed).every(Boolean)) {
      setError('Confirme os documentos e a autorização para seus dados de treino.')
      return
    }

    // A idade mínima só é exigida junto do aceite legal (mesma condição de antes, só
    // que agora calculada de verdade a partir da data — nunca mais uma caixinha de
    // autodeclaração). O campo em si (formato, não pode ser futura) sempre é validado.
    const validationErrors = {
      ...validateUsername(username),
      ...validateBirthDate(birthDate, {
        minimumAge: LEGAL_MANIFEST.published ? LEGAL_MANIFEST.minimumAge : undefined,
      }),
      ...validateSexo(sexo),
    }
    setFieldErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      if (createdAccount) {
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
        await setBirthInfo(uid, { sexo, dataNascimento: birthDate })
      } catch (postCreateErr) {
        // A conta no Authentication já existe nesse ponto, e os passos acima podem já
        // ter escrito o perfil (e reservado o @) no Firestore antes de falhar. Desfaz
        // tudo: primeiro os documentos (as regras só permitem isso nos minutos
        // seguintes à criação), depois a conta em si — sem isso, o e-mail ficaria
        // bloqueado E o perfil ficaria órfão no banco pra sempre.
        // setUsername() normaliza (trim + minúsculas) antes de gravar/reservar — a
        // limpeza precisa mirar o mesmo valor, não o texto bruto do campo.
        await deleteFreshProfile(uid, username.trim().toLowerCase()).catch((cleanupErr) => {
          console.error('[Auth] register rollback failed (profile):', cleanupErr)
        })
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
