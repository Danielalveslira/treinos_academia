import { AuthLayout } from '../components/PublicLayout'
import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { track } from '@vercel/analytics'
import { Button, FormControl, TextInput, Select, Link, Flash, Stack } from '@primer/react'
import {
  registerUser,
  confirmSignupAndSyncPassword,
  sendVerificationEmail,
} from '../services/authService'
import { isUsernameAvailable } from '../services/usersService'
import { completeUserProfile } from '../services/profileCompletion'
import { useAuth } from '../hooks/useAuth'
import { translateAuthError } from '../utils/authErrors'
import {
  validateUsername,
  validateBirthDate,
  validateSexo,
  validateUsageProfile,
  validatePassword,
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

const RESEND_COOLDOWN_S = 60

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
  // 'form': formulário de cadastro normal. 'confirm': conta já criada no Auth, mas sem
  // sessão (Confirm email exige o código antes de liberar auth.uid()) -- ver
  // confirmSignupOtp. 'locked': código certo, mas não foi possível confirmar que a senha
  // da conta é a que está neste formulário (ver confirmSignupAndSyncPassword) -- nunca
  // concede acesso nesse estado. Os dados do formulário continuam em memória nos estados
  // acima.
  const [step, setStep] = useState('form')
  const [otpCode, setOtpCode] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Cosmético (o Auth já recusa reenvios em excesso com over_email_send_rate_limit de
  // qualquer forma) -- evita martelar o botão sem necessidade.
  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

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

  // Roda a sequência de RPCs que monta o perfil (username, nascimento, display name,
  // usageProfile, aceite legal) e navega para o app. Chamada em dois pontos: logo após
  // o signUp quando já há sessão (confirmação desligada/autoconfirm), e depois de
  // confirmSignupOtp estabelecer a sessão (confirmação ligada). auth.uid() precisa
  // existir nos dois casos -- sem sessão, todas essas RPCs falham com NOT_AUTHENTICATED.
  async function completeProfile(uid) {
    try {
      await completeUserProfile(uid, { username, sexo, birthDate, usageProfile })
    } catch (postCreateErr) {
      // Preserva identidade, perfil e reservas. Exclusão só pelo fluxo oficial. Se o
      // usuário não voltar a esta aba, ProfileCompletionGate completa isso no próximo
      // login (username ainda nulo é o gatilho) -- não precisa de retentativa aqui.
      console.error('[Auth] register profile incomplete:', postCreateErr)
      setError(
        'Sua conta foi criada, mas o perfil não foi concluído. Tente novamente para concluir nesta página ou entre com seu e-mail e senha para completar o perfil. Se quiser excluir a conta, use o atendimento e o fluxo oficial de exclusão.'
      )
      return false
    }
    try {
      if (legalBundle.manifest.published) await acceptLegalDocuments(confirmed, legalBundle)
      await refreshProfile(uid)
    } catch (err) {
      setError(
        isLegalPolicyChangedError(err) || err?.message === 'LEGAL_POLICY_INCOMPATIBLE'
          ? 'Os documentos ativos mudaram. Recarregue a página, leia a versão atual e tente novamente.'
          : err.code?.startsWith('functions/')
          ? 'Sua conta foi criada, mas o aceite não foi registrado. Tente novamente ou entre na conta para concluir.'
          : translateAuthError(err)
      )
      return false
    }
    // replace: mesmo motivo do Login — depois de autenticado, cadastro/login não devem
    // continuar acessíveis pelo botão voltar.
    track('Signup complete')
    navigate('/app', { replace: true })
    return true
  }

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
      ...(createdAccount ? {} : validatePassword(password)),
    }
    setFieldErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      let uid = createdAccount
      if (!uid) {
        // Antes de criar a identidade, evita reservar um e-mail para um @ já ocupado.
        const available = await isUsernameAvailable(username)
        if (!available) {
          setFieldErrors({ username: 'Esse nome de usuário já está em uso' })
          return
        }
        const credential = await registerUser(email, password)
        uid = credential.user.uid
        // Retentativas desta página retomam as etapas idempotentes, sem outro signUp.
        setCreatedAccount(uid)
        if (!credential.hasSession) {
          // Confirm email ligado: sem sessão ainda, as RPCs de perfil abaixo falhariam
          // com NOT_AUTHENTICATED. Aguarda o código antes de prosseguir. O signUp já
          // disparou o e-mail com o código -- cooldown inicial evita um "reenviar"
          // imediato que bateria no rate limit do próprio envio que acabou de ocorrer.
          setStep('confirm')
          setCooldown(RESEND_COOLDOWN_S)
          return
        }
      }
      await completeProfile(uid)
    } catch (err) {
      console.error('[Auth] register:', err)
      setError(translateAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirmSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setConfirmError('')
    setSubmitting(true)
    try {
      // Confirma o código e só então alinha a senha da conta com a deste formulário --
      // nunca nas duas etapas separadas: se a senha não puder ser confirmada, a sessão já
      // é encerrada aqui dentro (ver nota de pre-account hijacking em authService.js) e o
      // catch abaixo cai no ramo 'locked', nunca em completeProfile.
      await confirmSignupAndSyncPassword(email, otpCode.trim(), password)
      const ok = await completeProfile(createdAccount)
      // completeProfile já preenche `error`; volta para a etapa do formulário no modo
      // de retentativa (createdAccount setado => handleSubmit pula o signUp e chama
      // completeProfile direto de novo), igual ao caminho que já existia antes desta
      // etapa de confirmação.
      if (!ok) setStep('form')
    } catch (err) {
      console.error('[Auth] confirmSignupOtp:', err)
      if (err?.code === 'PASSWORD_SYNC_FAILED') {
        setStep('locked')
      } else {
        setConfirmError(translateAuthError(err))
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend() {
    if (resending || cooldown > 0) return
    setResending(true)
    setConfirmError('')
    setResent(false)
    try {
      await sendVerificationEmail(email)
      if (mounted.current) {
        setResent(true)
        setCooldown(RESEND_COOLDOWN_S)
      }
    } catch (err) {
      console.error('[Auth] sendVerificationEmail:', err)
      if (mounted.current) setConfirmError(translateAuthError(err))
    } finally {
      if (mounted.current) setResending(false)
    }
  }

  if (step === 'locked') {
    return (
      <AuthLayout
        title="Confirme sua senha por segurança"
        description="Seu e-mail foi confirmado, mas não foi possível garantir que esta é a senha da conta. Por segurança, defina uma senha nova para continuar."
        footer={
          <Link as={RouterLink} to="/login" replace>
            Voltar para entrar
          </Link>
        }
      >
        <Stack gap="normal">
          <Flash role="alert" variant="danger">
            Não foi possível confirmar sua senha. Use &quot;Esqueci minha senha&quot; com este
            e-mail para definir uma senha nova -- isso nunca falha por este motivo.
          </Flash>
          <Button
            as={RouterLink}
            to="/esqueci-senha"
            state={{ email }}
            variant="primary"
            size="large"
            block
          >
            Ir para &quot;Esqueci minha senha&quot;
          </Button>
        </Stack>
      </AuthLayout>
    )
  }

  if (step === 'confirm') {
    return (
      <AuthLayout
        title="Confirme seu e-mail"
        description={`Enviamos um código de 6 dígitos para ${email}. Digite-o abaixo para concluir o cadastro.`}
        footer={
          // Texto neutro de propósito -- nem confirma nem nega que já existe uma conta
          // com este e-mail (um signUp repetido no Supabase hospedado pode devolver uma
          // resposta indistinguível de sucesso, sem enviar e-mail, para um e-mail já
          // confirmado). Quem já tem conta segue por aqui sem precisar decifrar a tela.
          <>
            Já tem uma conta?{' '}
            <Link as={RouterLink} to="/login" replace>
              Entre
            </Link>{' '}
            ou{' '}
            <Link as={RouterLink} to="/esqueci-senha" state={{ email }} replace>
              recupere sua senha
            </Link>
            .
          </>
        }
      >
        <form onSubmit={handleConfirmSubmit} className="public-form">
          <Stack gap="normal">
            {confirmError && (
              <Flash role="alert" variant="danger">
                {confirmError}
              </Flash>
            )}
            {error && (
              <Flash role="alert" variant="danger">
                {error}
              </Flash>
            )}
            {resent && !confirmError && (
              <Flash variant="success" role="status">
                Código reenviado para {email}.
              </Flash>
            )}

            <FormControl required>
              <FormControl.Label>Código de confirmação</FormControl.Label>
              <TextInput
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                size="large"
                block
              />
              <FormControl.Caption>Confira também a caixa de spam.</FormControl.Caption>
            </FormControl>

            <Button
              type="submit"
              variant="primary"
              size="large"
              block
              loading={submitting}
              disabled={submitting || otpCode.trim().length !== 6}
            >
              Confirmar
            </Button>
            <Button
              type="button"
              block
              onClick={handleResend}
              loading={resending}
              disabled={resending || cooldown > 0}
            >
              {cooldown > 0 ? `Reenviar código (${cooldown}s)` : 'Reenviar código'}
            </Button>
          </Stack>
        </form>
      </AuthLayout>
    )
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
              disabled={Boolean(createdAccount)}
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
              disabled={Boolean(createdAccount)}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              size="large"
              block
            />
            <FormControl.Caption>Mínimo de 8 caracteres, com letras e números.</FormControl.Caption>
            {fieldErrors.password && (
              <FormControl.Validation variant="error">
                {fieldErrors.password}
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
            {createdAccount ? 'Concluir cadastro' : 'Criar conta'}
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  )
}
