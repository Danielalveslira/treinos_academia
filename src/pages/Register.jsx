import { AuthLayout } from '../components/PublicLayout'
import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Button, FormControl, TextInput, Select, Link, Flash, Stack } from '@primer/react'
import { registerUser, setDisplayName, sendVerificationEmail } from '../services/authService'
import {
  ensureUserProfile,
  setUsername,
  setBirthInfo,
  isUsernameAvailable,
  deleteFreshProfile,
} from '../services/usersService'
import { setUsageProfile } from '../services/usageProfileService'
import { useAuth } from '../hooks/useAuth'
import { translateAuthError } from '../utils/authErrors'
import {
  validateUsername,
  validateBirthDate,
  validateSexo,
  validateUsageProfile,
  hasErrors,
} from '../utils/validators'
import { UsageProfileField } from '../components/UsageProfileField'
import { LegalConsent } from '../components/LegalConsent'
import { canSubmitLegalRegistration } from '../utils/legal'
import {
  acceptLegalDocuments,
  getActiveLegalBundle,
  isLegalPolicyChangedError,
} from '../services/legalService'

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
  // Sem valor inicial de propósito -- "Como você pretende utilizar o Evolutus?" exige
  // uma escolha explícita, ao contrário de sexo (que já nasce com "Não informar").
  const [usageProfile, setUsageProfileField] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdAccount, setCreatedAccount] = useState(null)
  const [confirmed, setConfirmed] = useState({
    accepted: false,
    healthDataConsent: false,
  })
  const [legalBundle, setLegalBundle] = useState(null)
  const [legalLoading, setLegalLoading] = useState(true)
  const [legalError, setLegalError] = useState('')

  useEffect(() => {
    let active = true
    getActiveLegalBundle()
      .then((bundle) => {
        if (active) setLegalBundle(bundle)
      })
      .catch((err) => {
        if (active) setLegalError(err.message === 'LEGAL_POLICY_INCOMPATIBLE'
          ? 'Os documentos ativos não são compatíveis com esta versão. Recarregue a página.'
          : 'Não foi possível carregar os documentos. Verifique sua conexão e recarregue a página.')
      })
      .finally(() => {
        if (active) setLegalLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (legalLoading || !legalBundle) {
      setError(legalError || 'Aguarde o carregamento dos documentos antes de criar a conta.')
      return
    }
    if (!canSubmitLegalRegistration({ bundle: legalBundle, loading: legalLoading, confirmed })) {
      setError('Confirme os documentos e a autorização para seus dados de treino.')
      return
    }

    // A idade mínima só é exigida junto do aceite legal (mesma condição de antes, só
    // que agora calculada de verdade a partir da data — nunca mais uma caixinha de
    // autodeclaração). O campo em si (formato, não pode ser futura) sempre é validado.
    const validationErrors = {
      ...validateUsername(username),
      ...validateBirthDate(birthDate, {
        minimumAge: legalBundle.manifest.published ? legalBundle.manifest.minimumAge : undefined,
      }),
      ...validateSexo(sexo),
      ...validateUsageProfile(usageProfile),
    }
    setFieldErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      if (createdAccount) {
        await acceptLegalDocuments(confirmed, legalBundle)
        await refreshProfile(createdAccount)
        // replace: mesmo motivo do Login — depois de autenticado, cadastro/login não devem
        // continuar acessíveis pelo botão voltar.
        navigate('/', { replace: true })
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
        await setDisplayName(credential.user, username)
      } catch (postCreateErr) {
        // A conta no Auth já existe nesse ponto, e os passos acima podem já ter escrito
        // o perfil (e reservado o @) antes de falhar. deleteFreshProfile desfaz tudo:
        // primeiro as linhas de perfil, depois a conta em si (deleteCurrentAccount, via
        // RPC, já embutido nela) — sem isso, o e-mail ficaria bloqueado E o perfil
        // ficaria órfão no banco pra sempre. setUsername() normaliza (trim + minúsculas)
        // antes de gravar/reservar — a limpeza precisa mirar o mesmo valor, não o texto
        // bruto do campo.
        await deleteFreshProfile(uid, username.trim().toLowerCase()).catch((cleanupErr) => {
          console.error('[Auth] register rollback failed:', cleanupErr)
        })
        if (postCreateErr.message === 'USERNAME_TAKEN') {
          setFieldErrors({ username: 'Esse nome de usuário já está em uso' })
          return
        }
        throw postCreateErr
      }
      setCreatedAccount(uid)
      // Best-effort: um problema aqui não deve desfazer a conta que acabou de ser criada
      // (diferente do bloco acima) — o usuário ainda consegue reenviar pelo próprio
      // EmailVerificationGate assim que cair na tela de bloqueio.
      sendVerificationEmail(credential.user).catch((sendErr) => {
        console.error('[Auth] sendVerificationEmail:', sendErr)
      })
      // Também best-effort e pela mesma razão: se isto falhar, a conta segue existindo
      // sem usageProfile e é recuperada pelo mesmo preenchimento contextual de contas
      // legadas (Meu Perfil/fluxo da Vitrine) -- nunca precisa desfazer o cadastro.
      setUsageProfile(usageProfile).catch((profileErr) => {
        console.error('[Auth] setUsageProfile:', profileErr)
      })
      if (legalBundle.manifest.published) await acceptLegalDocuments(confirmed, legalBundle)
      await refreshProfile(uid)
      // replace: mesmo motivo do Login — depois de autenticado, cadastro/login não devem
      // continuar acessíveis pelo botão voltar.
      navigate('/', { replace: true })
    } catch (err) {
      console.error('[Auth] register:', err)
      setError(
        isLegalPolicyChangedError(err) || err?.message === 'LEGAL_POLICY_INCOMPATIBLE'
          ? 'Os documentos ativos mudaram. Recarregue a página, leia a versão atual e tente novamente.'
          : err.code?.startsWith('functions/')
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
          <Link as={RouterLink} to="/login" replace>
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
          {legalError && (
            <Flash role="alert" variant="danger">
              {legalError}{' '}
              <Button type="button" variant="invisible" onClick={() => window.location.reload()}>
                Recarregar
              </Button>
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

          {legalBundle?.manifest.published && (
            <LegalConsent
              value={confirmed}
              onChange={setConfirmed}
              disabled={submitting}
              legalBundle={legalBundle}
            />
          )}

          <Button
            type="submit"
            variant="primary"
            size="large"
            block
            loading={submitting}
            disabled={submitting || legalLoading || !legalBundle || Boolean(legalError)}
          >
            Criar conta
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  )
}
