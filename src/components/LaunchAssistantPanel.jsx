import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  Flash,
  FormControl,
  Heading,
  Label,
  Spinner,
  Text,
  TextInput,
} from '@primer/react'
import { Link } from 'react-router-dom'
import {
  getLaunchVerification,
  activateOffering,
  activatePlacement,
} from '../services/launchAssistantService'
import { reauthenticatePricingAdmin } from '../services/evocashPricingService'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'
import { AuthCaptcha } from './AuthCaptcha'
import {
  buildRequirements,
  operationalSummary,
  findCurrentActivation,
  STATUS,
} from '../utils/launchAssistant'
import { commercialError } from '../utils/commercial'

const STATUS_LABEL = {
  [STATUS.DONE]: { text: 'concluído', variant: 'success' },
  [STATUS.PENDING]: { text: 'pendente', variant: 'attention' },
  [STATUS.PAUSED]: { text: 'pausado', variant: 'secondary' },
  [STATUS.BLOCKED]: { text: 'bloqueado', variant: 'danger' },
  [STATUS.UNAVAILABLE]: { text: 'indisponível', variant: 'secondary' },
}

const SUMMARY_VARIANT = {
  done: 'success',
  pending: 'attention',
  paused: 'secondary',
  unavailable: 'danger',
}

const ACTIVATION_JUSTIFICATION = 'Ativado via assistente de lançamento comercial.'

function RequirementRow({ row, onActivate }) {
  const badge = STATUS_LABEL[row.status]
  return (
    <Box
      as="li"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 2,
        py: 2,
        borderBottom: '1px solid',
        borderColor: 'border.muted',
      }}
    >
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
        <Text as="p" sx={{ m: 0, fontWeight: 'bold' }}>
          {row.label}
        </Text>
        <Text as="p" sx={{ m: 0, color: 'fg.muted', fontSize: 1 }}>
          {row.detail}
        </Text>
      </Box>
      <Label variant={badge.variant}>{badge.text}</Label>
      {row.action && (
        <Button as={Link} to={row.action.to} size="small">
          {row.action.label}
        </Button>
      )}
      {row.activation.map((activation) => (
        <Button
          key={activation.id}
          size="small"
          variant="primary"
          onClick={() => onActivate(activation)}
        >
          {activation.label}
        </Button>
      ))}
    </Box>
  )
}

function groupByCategory(rows) {
  const order = []
  const byCategory = new Map()
  for (const row of rows) {
    if (!byCategory.has(row.category)) {
      byCategory.set(row.category, [])
      order.push(row.category)
    }
    byCategory.get(row.category).push(row)
  }
  return order.map((category) => ({ category, rows: byCategory.get(category) }))
}

// `activation` é a descrição clicada (ver launchAssistant.js) -- id, kind, código e os
// parâmetros já calculados daquele momento. Antes de escrever de verdade, este diálogo
// busca o estado atual de novo e confirma que a MESMA ação específica ainda existe e
// ainda é elegível; se não, nunca escreve com dados antigos -- devolve a lista
// atualizada para o painel e avisa que a configuração mudou.
function ActivationDialog({ activation, onClose, onActivated, onStale }) {
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const captcha = useRef(null)
  const requestId = useRef(crypto.randomUUID())

  async function confirm() {
    if (lock.current || !confirmed || !captchaVerified || !password) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await reauthenticatePricingAdmin(password, takeCaptchaToken(captcha))
      // Revalidação imediatamente antes da escrita: o controle de revisão do servidor já
      // impede uma escrita sobre dado obsoleto, mas aqui também confirmamos que a ação
      // ainda existe e segue elegível, para nunca tentar com uma revisão que já sabemos
      // estar errada e para dar um aviso claro em vez de só um erro de conflito.
      const freshRequirements = buildRequirements(await getLaunchVerification())
      const current = findCurrentActivation(freshRequirements, activation.id)
      if (!current) {
        onStale(freshRequirements)
        return
      }
      if (current.kind === 'offering') {
        await activateOffering({
          code: current.code,
          revision: current.revision,
          requestId: requestId.current,
          reason: ACTIVATION_JUSTIFICATION,
        })
      } else {
        await activatePlacement({
          code: current.code,
          capacity: current.capacity,
          revision: current.revision,
          salesEnabled: current.salesEnabled,
          deliveryEnabled: current.deliveryEnabled,
          reason: ACTIVATION_JUSTIFICATION,
        })
      }
      onActivated()
    } catch (e) {
      setError(commercialError(e))
    } finally {
      captcha.current?.reset()
      setPassword('')
      lock.current = false
      setBusy(false)
    }
  }

  const valid = password.length > 0 && confirmed && captchaVerified

  return (
    <Dialog
      title={activation.confirmTitle}
      onClose={busy ? () => {} : onClose}
      footerButtons={[
        { content: 'Cancelar', onClick: onClose, disabled: busy },
        {
          content: busy ? 'Ativando…' : 'Confirmar ativação',
          buttonType: 'primary',
          onClick: confirm,
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
          {activation.confirmText} Justificativa registrada:{' '}
          <Text as="span" sx={{ fontStyle: 'italic' }}>
            {ACTIVATION_JUSTIFICATION}
          </Text>
        </Text>
        <FormControl required disabled={busy}>
          <FormControl.Label>Confirme sua senha</FormControl.Label>
          <TextInput
            block
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormControl>
        <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
        <FormControl disabled={busy}>
          <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <FormControl.Label>Confirmo a ativação desta modalidade.</FormControl.Label>
        </FormControl>
      </Box>
    </Dialog>
  )
}

// Painel completo (requisitos + ativação), importado sob demanda só quando o assistente
// é aberto -- ver LaunchAssistant.jsx, que mantém o cartão fechado leve (sem este bundle,
// sem nenhuma consulta) até o clique em "Abrir assistente".
export default function LaunchAssistantPanel({ onClose }) {
  const [state, setState] = useState({ status: 'loading', requirements: [] })
  const [activating, setActivating] = useState(null)
  const [notice, setNotice] = useState('')
  const active = useRef(true)

  async function load() {
    setState((prev) => ({ ...prev, status: 'loading' }))
    const data = await getLaunchVerification()
    if (active.current) setState({ status: 'ready', requirements: buildRequirements(data) })
  }

  useEffect(() => {
    active.current = true
    load()
    return () => {
      active.current = false
    }
  }, [])

  const summary = state.status === 'ready' ? operationalSummary(state.requirements) : null

  return (
    <Box
      as="section"
      sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Heading as="h2" sx={{ fontSize: 2, m: 0 }}>
          Preparar publicidade
        </Heading>
        {summary && <Label variant={SUMMARY_VARIANT[summary.tone]}>{summary.text}</Label>}
        <Box sx={{ display: 'flex', gap: 2, ml: 'auto' }}>
          <Button
            size="small"
            onClick={() => {
              setNotice('')
              load()
            }}
            disabled={state.status === 'loading'}
          >
            Verificar novamente
          </Button>
          <Button size="small" onClick={onClose}>
            Fechar
          </Button>
        </Box>
      </Box>
      {notice && (
        <Flash variant="attention" role="status" sx={{ mb: 2 }}>
          {notice}
        </Flash>
      )}
      {state.status === 'loading' && <Spinner aria-label="Verificando requisitos" />}
      {state.status === 'ready' && (
        <Box>
          {groupByCategory(state.requirements).map(({ category, rows }) => (
            <Box key={category} sx={{ mb: 3 }}>
              <Heading as="h3" sx={{ fontSize: 1, color: 'fg.muted', mb: 1 }}>
                {category}
              </Heading>
              <Box as="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {rows.map((row) => (
                  <RequirementRow key={row.id} row={row} onActivate={setActivating} />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {activating && (
        <ActivationDialog
          activation={activating}
          onClose={() => setActivating(null)}
          onActivated={() => {
            setActivating(null)
            setNotice('')
            load()
          }}
          onStale={(freshRequirements) => {
            setActivating(null)
            setState({ status: 'ready', requirements: freshRequirements })
            setNotice(
              'A configuração mudou desde a última verificação. A lista foi atualizada -- revise antes de tentar novamente.'
            )
          }}
        />
      )}
    </Box>
  )
}
