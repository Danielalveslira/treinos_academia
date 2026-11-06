import { AuthLayout } from '../components/PublicLayout'
import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, Navigate, useNavigate } from 'react-router-dom'
import { track } from '@vercel/analytics'
import { Button, FormControl, TextInput, Select, Link, Flash, Stack } from '@primer/react'
import { CheckCircleFillIcon, CircleIcon, EyeClosedIcon, EyeIcon } from '@primer/octicons-react'
import {
  registerUser,
  confirmSignupAndSyncPassword,
  sendVerificationEmail,
} from '../services/authService'
import { isUsernameAvailable } from '../services/usersService'
import { completeUserProfile } from '../services/profileCompletion'
import { loadMunicipalityCatalog } from '../services/municipalityCatalog'
import { useAuth } from '../hooks/useAuth'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { translateAuthError } from '../utils/authErrors'
import { describeRegistrationError } from '../utils/registrationErrors'
import {
  validateUsername,
  validateEmail,
  validateBirthDate,
  validateSexo,
  validateUsageProfile,
  validatePassword,
  validateResidenceMunicipality,
  hasErrors,
  PASSWORD_MIN_LENGTH,
} from '../utils/validators'
import { SIGNUP_USAGE_PROFILE_OPTIONS } from '../constants/usageProfile'
import { UsageProfileField } from '../components/UsageProfileField'
import { CitySelector } from '../components/CitySelector'
import { AuthCaptcha } from '../components/AuthCaptcha'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'
import { SignupProgress } from '../components/SignupProgress'
import { LegalConsent } from '../components/LegalConsent'
import { canSubmitLegalRegistration } from '../utils/legal'
import { registrationMinimumAge } from '../constants/accountAge'
import { businessDayKey } from '../utils/businessDate'
import {
  acceptLegalDocuments,
  getActiveLegalBundle,
  isLegalPolicyChangedError,
} from '../services/legalService'

const RESEND_COOLDOWN_S = 60
const USERNAME_TAKEN = 'Esse nome de usuário já está em uso'

// Cadastro em 3 etapas na MESMA rota (sem navegação nem recarga): só a etapa atual é renderizada,
// e todos os dados vivem em `values` (fonte única) -- voltar/avançar nunca perde nada. A conta só é
// criada no fim da etapa 3; até lá nada sai do aparelho além da checagem de disponibilidade do @.
const STEP_COPY = {
  1: { title: 'Crie sua conta', description: 'Comece sua jornada no Evolutus.' },
  2: {
    title: 'Conte um pouco sobre você',
    description: 'Algumas informações para personalizar sua experiência.',
  },
  3: {
    title: 'Tudo pronto para começar',
    description: 'Escolha como pretende utilizar o Evolutus.',
  },
}
// Etapa dona de cada campo: um erro (local ou do servidor) leva de volta à etapa certa.
const STEP_OF_FIELD = {
  username: 1,
  email: 1,
  password: 1,
  birthDate: 2,
  city: 2,
  sexo: 2,
  usageProfile: 3,
  legal: 3,
}

function todayString() {
  return businessDayKey()
}

function firstStepWithError(errors) {
  return Math.min(...Object.keys(errors).map((field) => STEP_OF_FIELD[field] ?? 3))
}

export default function Register() {
  const navigate = useNavigate()
  const { user, loading: authLoading, refreshProfile } = useAuth()
  const online = useOnlineStatus()
  const [values, setValues] = useState({
    username: '',
    email: '',
    password: '',
    birthDate: '',
    // Código IBGE escolhido no CitySelector (null = nenhuma seleção válida; texto livre nunca vira valor).
    cityCode: null,
    // Sem pré-seleção: Sexo é obrigatório e "Não informar" precisa ser uma escolha explícita.
    sexo: '',
    // Sem valor inicial de propósito -- o perfil de uso exige escolha explícita.
    usageProfile: '',
  })
  const { username, email, password, birthDate, cityCode, sexo, usageProfile } = values
  const [formStep, setFormStep] = useState(1)
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  // Disponibilidade do @ (cache do último valor checado): checada ao sair do campo e ao continuar,
  // nunca a cada tecla, e nunca duas vezes para o mesmo valor.
  const [usernameStatus, setUsernameStatus] = useState({ value: '', state: 'idle' })
  const usernameCheck = useRef(0)
  const [checkingStep, setCheckingStep] = useState(false)
  const continueInFlight = useRef(false)
  // Trava síncrona contra envio duplo (duplo toque/Enter repetido antes do re-render de `submitting`).
  const inFlight = useRef(false)
  // Marcado ANTES do signUp: a partir daí a sessão que aparecer é a desta página, não uma conta que
  // já estava logada -- ver o redirecionamento de usuários autenticados abaixo.
  const signupStarted = useRef(false)
  const formRef = useRef(null)
  const titleRef = useRef(null)
  // Pedido de foco depois do render: 'title' (troca de etapa) ou 'error' (1º campo inválido).
  const [focusRequest, setFocusRequest] = useState(null)
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
  // 'form': formulário de cadastro normal. 'confirm': resposta sem sessão, que não
  // comprova criação de conta nem entrega de e-mail. 'locked': código certo, mas não foi possível confirmar que a senha
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
  const resendInFlight = useRef(false)
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // O catálogo de cidades (chunk próprio, só desta página) começa a baixar já na etapa 1, para estar
  // pronto quando a pessoa chegar à etapa 2 mesmo em conexão lenta. Falha aqui é silenciosa: o
  // seletor mostra o erro e o "tentar novamente" quando for usado.
  useEffect(() => {
    loadMunicipalityCatalog().catch(() => {})
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
        if (active)
          setLegalError(
            err.message === 'LEGAL_POLICY_INCOMPATIBLE'
              ? 'Os documentos ativos não são compatíveis com esta versão. Recarregue a página.'
              : 'Não foi possível carregar os documentos. Verifique sua conexão e recarregue a página.'
          )
      })
      .finally(() => {
        if (active) setLegalLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Foco gerenciado: depois de trocar de etapa vai para o título (leitores de tela anunciam a etapa
  // nova); depois de uma validação com erro, para o primeiro campo a corrigir.
  useEffect(() => {
    if (!focusRequest) return
    if (focusRequest.kind === 'error') {
      const invalid = formRef.current?.querySelector(
        '[aria-invalid="true"], [data-field-error="true"]'
      )
      const target = invalid?.matches('input, select, textarea')
        ? invalid
        : invalid?.querySelector('input, select, textarea, [tabindex]')
      if (target) {
        target.focus({ preventScroll: true })
        target.scrollIntoView?.({ block: 'center' })
        return
      }
    }
    titleRef.current?.focus({ preventScroll: true })
    titleRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [focusRequest])

  function requestFocus(kind) {
    setFocusRequest((current) => ({ kind, n: (current?.n ?? 0) + 1 }))
  }

  function setField(field, value, errorKey = field) {
    setValues((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) =>
      current[errorKey] ? { ...current, [errorKey]: undefined } : current
    )
  }

  function goToStep(target, focus = 'title') {
    setFormStep(target)
    requestFocus(focus)
  }

  // Mostra os erros e volta à etapa do primeiro deles (preservando todo o resto).
  function showFieldErrors(errors) {
    const clean = Object.fromEntries(Object.entries(errors).filter(([, message]) => message))
    setFieldErrors(clean)
    if (!hasErrors(clean)) return
    const target = firstStepWithError(clean)
    if (target !== formStep) setFormStep(target)
    requestFocus('error')
  }

  // Validação ao sair de um campo já preenchido: aponta o problema cedo, sem gritar antes da
  // primeira interação (campo vazio só é cobrado ao continuar).
  function validateOnBlur(field, errors) {
    if (!values[field]) return
    setFieldErrors((current) => ({ ...current, [field]: errors[field] }))
  }

  function birthDateRules() {
    return {
      minimumAge: registrationMinimumAge(legalBundle?.manifest),
    }
  }

  function stepErrors(target) {
    if (target === 1)
      return {
        ...validateUsername(username),
        ...(createdAccount ? {} : validateEmail(email)),
        ...(createdAccount ? {} : validatePassword(password)),
      }
    if (target === 2)
      return {
        ...validateBirthDate(birthDate, birthDateRules()),
        ...validateResidenceMunicipality(cityCode),
        ...validateSexo(sexo, { required: true }),
      }
    return {
      ...validateUsageProfile(usageProfile),
      ...(legalBundle &&
      !canSubmitLegalRegistration({ bundle: legalBundle, loading: legalLoading, confirmed })
        ? { legal: 'Aceite os Termos de Uso e as Regras da Comunidade para criar a conta.' }
        : {}),
    }
  }

  // Reaproveita o resultado já conhecido para o mesmo @ (sem nova requisição). Falha de rede não
  // bloqueia o avanço: a checagem definitiva roda de novo antes de criar a conta.
  async function checkUsernameAvailability(value = username.trim().toLowerCase()) {
    if (createdAccount || !value || hasErrors(validateUsername(value))) return true
    if (usernameStatus.value === value && usernameStatus.state === 'available') return true
    if (usernameStatus.value === value && usernameStatus.state === 'taken') return false
    const ticket = ++usernameCheck.current
    setUsernameStatus({ value, state: 'checking' })
    try {
      const available = await isUsernameAvailable(value)
      if (ticket === usernameCheck.current && mounted.current)
        setUsernameStatus({ value, state: available ? 'available' : 'taken' })
      return available
    } catch {
      if (ticket === usernameCheck.current && mounted.current)
        setUsernameStatus({ value, state: 'error' })
      return true
    }
  }

  async function handleUsernameBlur() {
    const value = username.trim().toLowerCase()
    if (!value) return
    const formatErrors = validateUsername(value)
    if (hasErrors(formatErrors)) {
      setFieldErrors((current) => ({ ...current, username: formatErrors.username }))
      return
    }
    const available = await checkUsernameAvailability(value)
    if (!available && mounted.current)
      setFieldErrors((current) => ({ ...current, username: USERNAME_TAKEN }))
  }

  async function handleContinue() {
    if (continueInFlight.current || inFlight.current) return
    setError('')
    const errors = stepErrors(formStep)
    if (hasErrors(errors)) {
      showFieldErrors(errors)
      return
    }
    setFieldErrors({})
    if (formStep === 1 && !createdAccount) {
      continueInFlight.current = true
      setCheckingStep(true)
      let available
      try {
        available = await checkUsernameAvailability()
      } finally {
        continueInFlight.current = false
        if (mounted.current) setCheckingStep(false)
      }
      if (!mounted.current) return
      if (!available) {
        showFieldErrors({ username: USERNAME_TAKEN })
        return
      }
    }
    goToStep(formStep + 1)
  }

  function handleBack() {
    if (submitting || formStep === 1) return
    setError('')
    goToStep(formStep - 1)
  }

  // Roda a sequência de RPCs que monta o perfil (username, nascimento, cidade, display name,
  // usageProfile, aceite legal) e navega para o app. Chamada em dois pontos: logo após
  // o signUp quando já há sessão (confirmação desligada/autoconfirm), e depois de
  // confirmSignupOtp estabelecer a sessão (confirmação ligada). auth.uid() precisa
  // existir nos dois casos -- sem sessão, todas essas RPCs falham com NOT_AUTHENTICATED.
  async function completeProfile(uid) {
    try {
      await completeUserProfile(uid, {
        username,
        sexo,
        birthDate,
        usageProfile,
        residenceMunicipalityCode: cityCode,
      })
    } catch (postCreateErr) {
      // Preserva identidade, perfil e reservas. Exclusão só pelo fluxo oficial. Se o
      // usuário não voltar a esta aba, ProfileCompletionGate completa isso no próximo
      // login (username ainda nulo é o gatilho) -- não precisa de retentativa aqui.
      console.error('[Auth] register profile incomplete:', postCreateErr)
      const described = describeRegistrationError(postCreateErr)
      if (described.field) {
        // Ex.: @ ocupado entre a checagem e a gravação. Só esse campo precisa mudar; o resto
        // continua preenchido e "Concluir cadastro" retoma sem criar outra conta.
        if (described.field === 'username')
          setUsernameStatus({ value: username.trim().toLowerCase(), state: 'taken' })
        showFieldErrors({ [described.field]: described.message })
        setError('Sua conta foi criada. Corrija o campo indicado e conclua o cadastro.')
      } else {
        setError(
          `Sua conta foi criada, mas o perfil não foi concluído. ${
            described.message === translateAuthError(postCreateErr) ? '' : `${described.message} `
          }Tente novamente para concluir nesta página ou entre com seu e-mail e senha para completar o perfil. Se quiser excluir a conta, use o atendimento e o fluxo oficial de exclusão.`
        )
      }
      return false
    }
    try {
      if (legalBundle.manifest.published)
        await acceptLegalDocuments(confirmed, legalBundle, 'signup')
      await refreshProfile(uid)
    } catch (err) {
      setError(
        isLegalPolicyChangedError(err) || err?.message === 'LEGAL_POLICY_INCOMPATIBLE'
          ? 'Os documentos ativos mudaram. Recarregue a página, leia a versão atual e tente novamente.'
          : err.code?.startsWith('functions/')
            ? 'Sua conta foi criada, mas o aceite não foi registrado. Tente novamente ou entre na conta para concluir.'
            : describeRegistrationError(err).message
      )
      return false
    }
    // replace: mesmo motivo do Login — depois de autenticado, cadastro/login não devem
    // continuar acessíveis pelo botão voltar.
    track('Signup complete')
    navigate('/app', { replace: true })
    return true
  }

  async function handleCreate() {
    if (inFlight.current) return
    setError('')
    if (legalLoading || !legalBundle) {
      setError(legalError || 'Aguarde o carregamento dos documentos antes de criar a conta.')
      return
    }

    // Revalida TUDO (inclusive etapas anteriores): um erro leva de volta à etapa dele. A idade
    // mínima (16 anos, ou mais se o manifesto jurídico vigente exigir) é checada antes de criar
    // a identidade. O backend valida novamente.
    const validationErrors = { ...stepErrors(1), ...stepErrors(2), ...stepErrors(3) }
    if (hasErrors(validationErrors)) {
      showFieldErrors(validationErrors)
      const fields = Object.keys(validationErrors)
      setError(
        fields.length === 1 && fields[0] === 'legal'
          ? validationErrors.legal
          : 'Revise os campos destacados.'
      )
      return
    }

    inFlight.current = true
    setSubmitting(true)
    try {
      let uid = createdAccount
      if (!uid) {
        // Antes de criar a identidade, evita reservar um e-mail para um @ já ocupado. Checagem
        // definitiva (não usa o cache): o @ pode ter sido ocupado enquanto a pessoa preenchia.
        const available = await isUsernameAvailable(username)
        if (!available) {
          setUsernameStatus({ value: username.trim().toLowerCase(), state: 'taken' })
          showFieldErrors({ username: USERNAME_TAKEN })
          setError('Esse nome de usuário acabou de ser ocupado. Escolha outro para continuar.')
          return
        }
        const captchaToken = takeCaptchaToken(captcha)
        signupStarted.current = true
        const credential = await registerUser(email.trim(), password, captchaToken)
        if (!credential.hasSession) {
          // O retorno pode ser ofuscado para uma identidade existente. Sem sessão,
          // não vinculamos o UID ao formulário nem afirmamos que houve envio.
          setStep('confirm')
          setCooldown(RESEND_COOLDOWN_S)
          return
        }
        uid = credential.user.uid
        // Retentativas com sessão retomam as etapas idempotentes, sem outro signUp.
        setCreatedAccount(uid)
      }
      await completeProfile(uid)
    } catch (err) {
      // signUp não criou nada (ou não se sabe): libera um novo envio pelo caminho normal.
      if (!createdAccount) signupStarted.current = false
      const described = describeRegistrationError(err)
      if (err?.code === 'email_address_invalid') showFieldErrors({ email: described.message })
      else if (err?.code === 'weak_password') showFieldErrors({ password: described.message })
      else if (described.field) showFieldErrors({ [described.field]: described.message })
      setError(described.message)
    } finally {
      captcha.current?.reset()
      inFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    // Enter num campo das etapas 1-2 equivale a "Continuar" (nunca cria a conta antes da etapa 3).
    if (formStep < 3) handleContinue()
    else handleCreate()
  }

  async function handleConfirmSubmit(e) {
    e.preventDefault()
    if (inFlight.current || resendInFlight.current) return
    setConfirmError('')
    inFlight.current = true
    setSubmitting(true)
    try {
      // Confirma o código e só então alinha a senha da conta com a deste formulário --
      // nunca nas duas etapas separadas: se a senha não puder ser confirmada, a sessão já
      // é encerrada aqui dentro (ver nota de pre-account hijacking em authService.js) e o
      // catch abaixo cai no ramo 'locked', nunca em completeProfile.
      const confirmedAccount = await confirmSignupAndSyncPassword(
        email.trim(),
        otpCode.trim(),
        password
      )
      setCreatedAccount(confirmedAccount.uid)
      const ok = await completeProfile(confirmedAccount.uid)
      // completeProfile já preenche `error` (e a etapa do campo a corrigir, se houver); volta ao
      // formulário no modo de retentativa (createdAccount setado => o envio pula o signUp e chama
      // completeProfile direto de novo).
      if (!ok) setStep('form')
    } catch (err) {
      if (err?.code === 'PASSWORD_SYNC_FAILED') {
        setStep('locked')
      } else {
        setConfirmError(describeRegistrationError(err).message)
      }
    } finally {
      inFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
  }

  async function handleResend() {
    if (inFlight.current || resendInFlight.current || cooldown > 0) return
    resendInFlight.current = true
    setResending(true)
    setConfirmError('')
    setResent(false)
    try {
      await sendVerificationEmail(email.trim(), takeCaptchaToken(captcha))
      if (mounted.current) {
        setResent(true)
        setCooldown(RESEND_COOLDOWN_S)
      }
    } catch (err) {
      if (mounted.current) setConfirmError(describeRegistrationError(err).message)
    } finally {
      captcha.current?.reset()
      resendInFlight.current = false
      if (mounted.current) setResending(false)
    }
  }

  // Quem já está logado não tem o que fazer aqui (mesma regra do Login): sem isto, um segundo signUp
  // a partir de uma sessão ativa trocaria a conta da aba. Não vale para a sessão criada por ESTE
  // cadastro (signupStarted), que precisa terminar o perfil antes de sair desta página. Uma conta
  // logada com perfil incompleto vai para /app, onde ProfileCompletionGate conclui o cadastro.
  if (!authLoading && user && !signupStarted.current && !createdAccount) {
    return <Navigate to="/app" replace />
  }

  if (step === 'locked') {
    return (
      <AuthLayout
        variant="signup"
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
        variant="signup"
        title="Confirme seu e-mail"
        description="Se este endereço puder receber uma confirmação, um código poderá chegar em breve. Digite o código para continuar."
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
                Solicitação de reenvio recebida. Se houver confirmação pendente, confira seu e-mail.
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
              disabled={submitting || resending || otpCode.trim().length !== 6}
            >
              Confirmar
            </Button>
            <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
            <Button
              type="button"
              block
              onClick={handleResend}
              loading={resending}
              disabled={submitting || resending || cooldown > 0 || !captchaVerified}
            >
              {cooldown > 0 ? `Reenviar código (${cooldown}s)` : 'Reenviar código'}
            </Button>
            <Button
              type="button"
              block
              disabled={submitting || resending}
              onClick={() => {
                setStep('form')
                setFormStep(1)
                setOtpCode('')
                setConfirmError('')
                signupStarted.current = false
              }}
            >
              Corrigir e-mail
            </Button>
          </Stack>
        </form>
      </AuthLayout>
    )
  }

  const usernameValue = username.trim().toLowerCase()
  const usernameAvailable =
    !fieldErrors.username &&
    usernameStatus.state === 'available' &&
    usernameStatus.value === usernameValue
  const passwordRules = [
    { label: `${PASSWORD_MIN_LENGTH}+ caracteres`, met: password.length >= PASSWORD_MIN_LENGTH },
    { label: 'letras e números', met: /[A-Za-z]/.test(password) && /\d/.test(password) },
  ]
  const busy = submitting || checkingStep
  const copy = STEP_COPY[formStep]

  return (
    <AuthLayout
      variant="signup"
      titleRef={titleRef}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          Já tem uma conta?{' '}
          <Link as={RouterLink} to="/login" replace>
            Entrar
          </Link>
        </>
      }
    >
      <form ref={formRef} onSubmit={handleSubmit} className="public-form signup-form" noValidate>
        <Stack gap="normal">
          <SignupProgress current={formStep} />
          {!online && (
            // Criar conta exige o servidor; o aviso evita um envio que só falharia por rede.
            <Flash role="status">
              Você está sem internet. Conecte-se para criar sua conta — o que já foi preenchido
              continua aqui.
            </Flash>
          )}
          {error && (
            <Flash role="alert" variant="danger">
              {error}
            </Flash>
          )}

          {formStep === 1 && (
            <>
              <FormControl required disabled={busy}>
                <FormControl.Label>Nome de usuário</FormControl.Label>
                <TextInput
                  leadingVisual="@"
                  value={username}
                  onChange={(e) => setField('username', e.target.value)}
                  onBlur={handleUsernameBlur}
                  placeholder="seu_usuario"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={20}
                  size="large"
                  block
                />
                {!fieldErrors.username && (
                  <FormControl.Caption>
                    {usernameStatus.state === 'checking' &&
                    usernameStatus.value === usernameValue ? (
                      'Verificando disponibilidade…'
                    ) : usernameAvailable ? (
                      <span className="signup-ok">
                        <CheckCircleFillIcon size={12} /> @{usernameValue} está disponível
                      </span>
                    ) : (
                      '3 a 20 letras minúsculas, números ou _. Aparece nas comunidades.'
                    )}
                  </FormControl.Caption>
                )}
                {fieldErrors.username && (
                  <FormControl.Validation variant="error">
                    {fieldErrors.username}
                  </FormControl.Validation>
                )}
              </FormControl>

              <FormControl required disabled={busy || Boolean(createdAccount)}>
                <FormControl.Label>E-mail</FormControl.Label>
                <TextInput
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setField('email', e.target.value)}
                  onBlur={() => validateOnBlur('email', validateEmail(email))}
                  placeholder="nome@exemplo.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  size="large"
                  block
                />
                {createdAccount && (
                  <FormControl.Caption>Conta já criada com este e-mail.</FormControl.Caption>
                )}
                {fieldErrors.email && (
                  <FormControl.Validation variant="error">
                    {fieldErrors.email}
                  </FormControl.Validation>
                )}
              </FormControl>

              <FormControl required disabled={busy || Boolean(createdAccount)}>
                <FormControl.Label>Senha</FormControl.Label>
                <TextInput
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setField('password', e.target.value)}
                  onBlur={() => validateOnBlur('password', validatePassword(password))}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  size="large"
                  block
                  trailingAction={
                    <TextInput.Action
                      onClick={() => setShowPassword((shown) => !shown)}
                      icon={showPassword ? EyeClosedIcon : EyeIcon}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={showPassword}
                      tooltipDirection="nw"
                    />
                  }
                />
                <FormControl.Caption>
                  <span className="signup-password-rules">
                    {passwordRules.map((rule) => (
                      <span key={rule.label} className={rule.met ? 'is-met' : undefined}>
                        {rule.met ? <CheckCircleFillIcon size={12} /> : <CircleIcon size={12} />}{' '}
                        {rule.label}
                        <span className="sr-only">{rule.met ? ' (atendido)' : ' (pendente)'}</span>
                      </span>
                    ))}
                  </span>
                </FormControl.Caption>
                {fieldErrors.password && (
                  <FormControl.Validation variant="error">
                    {fieldErrors.password}
                  </FormControl.Validation>
                )}
              </FormControl>
            </>
          )}

          {formStep === 2 && (
            <>
              <FormControl required disabled={busy}>
                <FormControl.Label>Data de nascimento</FormControl.Label>
                <TextInput
                  type="date"
                  value={birthDate}
                  onChange={(e) => setField('birthDate', e.target.value)}
                  onBlur={() =>
                    validateOnBlur('birthDate', validateBirthDate(birthDate, birthDateRules()))
                  }
                  max={todayString()}
                  min="1900-01-01"
                  autoComplete="bday"
                  size="large"
                  block
                />
                <FormControl.Caption>
                  Cadastro disponível somente para pessoas com {birthDateRules().minimumAge} anos completos ou mais.
                </FormControl.Caption>
                {fieldErrors.birthDate && (
                  <FormControl.Validation variant="error">
                    {fieldErrors.birthDate}
                  </FormControl.Validation>
                )}
              </FormControl>

              <CitySelector
                value={cityCode}
                onChange={(code) => setField('cityCode', code, 'city')}
                error={fieldErrors.city}
                disabled={busy}
              />

              <FormControl required disabled={busy}>
                <FormControl.Label>Sexo</FormControl.Label>
                <Select
                  value={sexo}
                  onChange={(e) => setField('sexo', e.target.value)}
                  onBlur={() =>
                    // Só depois de interagir: sair sem escolher aponta o erro já aqui.
                    setFieldErrors((current) => ({
                      ...current,
                      sexo: validateSexo(sexo, { required: true }).sexo,
                    }))
                  }
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
                  <FormControl.Validation variant="error">
                    {fieldErrors.sexo}
                  </FormControl.Validation>
                )}
              </FormControl>
            </>
          )}

          {formStep === 3 && (
            <>
              {legalError && (
                <Flash role="alert" variant="danger">
                  {legalError}{' '}
                  <Button
                    type="button"
                    variant="invisible"
                    onClick={() => window.location.reload()}
                  >
                    Recarregar
                  </Button>
                </Flash>
              )}
              <UsageProfileField
                value={usageProfile}
                onChange={(value) => setField('usageProfile', value)}
                legend="Perfil de uso *"
                options={SIGNUP_USAGE_PROFILE_OPTIONS}
                invalid={Boolean(fieldErrors.usageProfile)}
                disabled={busy}
                compact
              />
              {fieldErrors.usageProfile && (
                <FormControl.Validation variant="error">
                  {fieldErrors.usageProfile}
                </FormControl.Validation>
              )}

              {legalBundle?.manifest.published && (
                <div
                  className="signup-consent"
                  data-field-error={fieldErrors.legal ? 'true' : undefined}
                >
                  <LegalConsent
                    value={confirmed}
                    onChange={(value) => {
                      setConfirmed(value)
                      setFieldErrors((current) =>
                        current.legal ? { ...current, legal: undefined } : current
                      )
                    }}
                    disabled={busy}
                    legalBundle={legalBundle}
                  />
                </div>
              )}
              {fieldErrors.legal && (
                <FormControl.Validation variant="error">{fieldErrors.legal}</FormControl.Validation>
              )}
            </>
          )}

          {formStep === 3 && !createdAccount && (
            <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
          )}

          <div className={formStep > 1 ? 'signup-actions has-back' : 'signup-actions'}>
            {formStep > 1 && (
              <Button type="button" size="large" onClick={handleBack} disabled={submitting}>
                Voltar
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              size="large"
              block
              loading={busy}
              disabled={
                busy ||
                (formStep === 3 &&
                  (legalLoading ||
                    !legalBundle ||
                    Boolean(legalError) ||
                    (!createdAccount && !captchaVerified)))
              }
            >
              {formStep < 3 ? 'Continuar' : createdAccount ? 'Concluir cadastro' : 'Criar conta'}
            </Button>
          </div>
        </Stack>
      </form>
    </AuthLayout>
  )
}
