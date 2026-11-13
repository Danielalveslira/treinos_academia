import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  Flash,
  FormControl,
  Heading,
  Spinner,
  Text,
  Textarea,
  TextInput,
} from '@primer/react'
import { AuthCaptcha } from './AuthCaptcha'
import { reauthenticatePricingAdmin } from '../services/evocashPricingService'
import {
  confirmSupplierInfoConfigured,
  getSupplierInfoActivationSafety,
  getSupplierInfoConfigured,
  verifySupplierInfoAudit,
} from '../services/supplierInfoGateService'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'

function errorMessage(error) {
  if (error?.code === 'captcha_failed')
    return 'A verificação de segurança falhou. Conclua-a novamente.'
  if (error?.code === '55P03')
    return 'Uma operação financeira está em andamento. Atualize o estado e tente novamente.'
  const messages = {
    RECENT_AUTH_REQUIRED: 'Confirme sua senha para continuar.',
    REAUTHENTICATION_FAILED: 'Não foi possível confirmar sua senha.',
    PERMISSION_DENIED: 'Sua conta ou sessão não permite esta operação.',
    INVALID_SUPPLIER_INFO_REQUEST: 'Confira a justificativa e a confirmação.',
    FINANCIAL_GATES_OPEN:
      'Há vendas ou cotações abertas, ou compras pendentes. A confirmação foi bloqueada.',
    SUPPLIER_INFO_FINANCIAL_GATES_OPEN:
      'As condições financeiras mudaram ou há checkout habilitado. A confirmação foi bloqueada pelo servidor.',
    FINANCIAL_STATE_UNVERIFIED: 'Não foi possível confirmar que as vendas estão fechadas.',
  }
  return (
    messages[error?.message] ||
    'Não foi possível concluir a operação. Atualize o estado antes de tentar novamente.'
  )
}

export default function SupplierInfoGateAdmin() {
  const [configured, setConfigured] = useState(null)
  const [safe, setSafe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const captcha = useRef(null)

  async function load() {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const [state, safety] = await Promise.all([
        getSupplierInfoConfigured(),
        getSupplierInfoActivationSafety(),
      ])
      setConfigured(state)
      setSafe(safety.safe)
    } catch {
      setConfigured(null)
      setSafe(null)
      setError('Não foi possível consultar o estado da identificação do fornecedor.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function close() {
    if (lock.current) return
    setOpen(false)
    setReason('')
    setPassword('')
    setConfirmed(false)
    setError('')
  }

  async function save() {
    const justification = reason.trim()
    if (
      lock.current ||
      configured !== false ||
      safe !== true ||
      justification.length < 5 ||
      justification.length > 500 ||
      !password ||
      !confirmed ||
      !captchaVerified
    )
      return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    let rpcCompleted = false
    try {
      await reauthenticatePricingAdmin(password, takeCaptchaToken(captcha))
      setPassword('')
      const startedAt = Date.now()
      await confirmSupplierInfoConfigured(justification)
      rpcCompleted = true
      setOpen(false)
      setReason('')
      setConfirmed(false)
      setNotice('Confirmação registrada. Conferindo o estado e a auditoria…')
      const current = await getSupplierInfoConfigured()
      setConfigured(current)
      if (!current) throw new Error('SUPPLIER_INFO_CONFIRMATION_UNVERIFIED')
      const audit = await verifySupplierInfoAudit(justification, startedAt)
      setNotice(
        `Identificação do fornecedor confirmada. Auditoria verificada em ${new Date(audit.createdAt).toLocaleString('pt-BR')}. Compras e checkout não foram ativados por esta ação.`
      )
    } catch (err) {
      if (rpcCompleted) {
        setNotice(
          'A RPC confirmou a configuração, mas a leitura de retorno ou da auditoria falhou. Atualize o estado antes de qualquer nova tentativa. Compras e checkout não foram ativados por esta ação.'
        )
      } else {
        setError(errorMessage(err))
        if (err?.message === 'FINANCIAL_GATES_OPEN') setSafe(false)
        // A resposta pode se perder após o commit. A leitura impede nova chamada cega da RPC.
        try {
          const current = await getSupplierInfoConfigured()
          setConfigured(current)
          if (current) {
            setOpen(false)
            setNotice(
              'A configuração está ativa, mas a confirmação da chamada não chegou. Verifique a auditoria antes de qualquer nova tentativa.'
            )
          }
        } catch {
          setConfigured(null)
          setOpen(false)
          setNotice(
            'Não foi possível confirmar o estado após a tentativa. Atualize a página antes de qualquer nova ação.'
          )
        }
      }
    } finally {
      captcha.current?.reset()
      setPassword('')
      lock.current = false
      setBusy(false)
    }
  }

  const valid =
    reason.trim().length >= 5 &&
    reason.trim().length <= 500 &&
    password.length > 0 &&
    confirmed &&
    captchaVerified
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 4 }}>
      <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
        Identificação do fornecedor
      </Heading>
      <Text as="p" sx={{ color: 'fg.muted' }}>
        A confirmação registra que os dados públicos do fornecedor foram conferidos. Esta ação não
        ativa ofertas, compras nem checkout.
      </Text>
      {loading ? (
        <Spinner aria-label="Consultando configuração do fornecedor" />
      ) : (
        <Text as="p" role="status">
          Estado:{' '}
          {configured === true ? 'confirmado' : configured === false ? 'pendente' : 'indisponível'}
        </Text>
      )}
      {safe === false && (
        <Flash variant="attention" role="status">
          Há vendas ou cotações abertas, ou compras pendentes. Resolva essas condições antes de
          confirmar a identificação do fornecedor.
        </Flash>
      )}
      {error && !open && (
        <Flash variant="danger" role="alert">
          {error}
        </Flash>
      )}
      {notice && (
        <Flash variant="success" role="status">
          {notice}
        </Flash>
      )}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button onClick={load} disabled={loading || busy}>
          Atualizar estado
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            setError('')
            setNotice('')
            setOpen(true)
          }}
          disabled={loading || configured !== false || safe !== true || busy}
        >
          Confirmar dados do fornecedor
        </Button>
      </Box>
      {open && (
        <Dialog
          title="Confirmar identificação do fornecedor"
          onClose={busy ? () => {} : close}
          footerButtons={[
            { content: 'Voltar', onClick: close, disabled: busy },
            {
              content: busy ? 'Confirmando…' : 'Confirmar',
              buttonType: 'primary',
              onClick: save,
              disabled: busy || !valid,
            },
          ]}
        >
          <Box sx={{ p: 3, display: 'grid', gap: 3 }}>
            {error && (
              <Flash variant="danger" role="alert">
                {error}
              </Flash>
            )}
            <Text as="p" sx={{ m: 0 }}>
              Confirme somente após conferir nome civil, CPF e endereço na página pública de
              produção. Nenhum desses dados será enviado nesta operação.
            </Text>
            <FormControl required>
              <FormControl.Label>Justificativa para auditoria</FormControl.Label>
              <Textarea
                block
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy}
              />
              <FormControl.Caption>
                De 5 a 500 caracteres. Não inclua dados pessoais.
              </FormControl.Caption>
            </FormControl>
            <FormControl required>
              <FormControl.Label>Confirme sua senha</FormControl.Label>
              <TextInput
                block
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </FormControl>
            <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
            <FormControl>
              <Checkbox
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={busy}
              />
              <FormControl.Label>
                Conferi os dados públicos e confirmo a alteração auditada de supplierInfo.configured
                para true.
              </FormControl.Label>
            </FormControl>
          </Box>
        </Dialog>
      )}
    </Box>
  )
}
