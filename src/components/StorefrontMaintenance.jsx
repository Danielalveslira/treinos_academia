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
  TextInput,
  Textarea,
} from '@primer/react'
import {
  associateLegacyProduct,
  configureStorefrontCleanup,
  getLegacyTarget,
  getStorefrontMaintenance,
  runStorefrontCleanup,
} from '../services/storefrontService'
import { reauthenticatePricingAdmin } from '../services/evocashPricingService'
import { AuthCaptcha } from './AuthCaptcha'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'
import { storefrontError } from '../utils/storefront'
export default function StorefrontMaintenance({ legacy, onCloseLegacy, onAssociated }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [dialog, setDialog] = useState(null),
    [hours, setHours] = useState(''),
    [enabled, setEnabled] = useState(false),
    [reason, setReason] = useState(''),
    [password, setPassword] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [destination, setDestination] = useState(''),
    [target, setTarget] = useState(null)
  const lock = useRef(false)
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)
  const destinationRequest = useRef(0)
  async function refresh() {
    try {
      setData(await getStorefrontMaintenance())
    } catch (e) {
      setError(storefrontError(e))
    }
  }
  useEffect(() => {
    refresh()
  }, [])
  useEffect(() => {
    if (legacy) {
      setDialog('legacy')
      setTarget(null)
      setDestination('')
      reset()
    }
  }, [legacy])
  function reset() {
    destinationRequest.current++
    setError('')
    setReason('')
    setPassword('')
    setConfirmed(false)
  }
  function open(kind) {
    reset()
    setHours(data?.settings.graceSeconds ? String(data.settings.graceSeconds / 3600) : '')
    setEnabled(Boolean(data?.settings.enabled))
    setDialog(kind)
  }
  function close() {
    if (busy) return
    destinationRequest.current++
    setDialog(null)
    setPassword('')
    onCloseLegacy?.()
  }
  async function save(e) {
    e.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await reauthenticatePricingAdmin(password, takeCaptchaToken(captcha))
      if (dialog === 'legacy') {
        await associateLegacyProduct({
          product: legacy,
          target,
          evidence: reason,
          requestId: legacy.requestId,
          confirm: confirmed,
        })
        await onAssociated()
        setMessage(
          'Produto associado ao rascunho. Envie uma imagem privada e solicite aprovação antes de publicar.'
        )
      } else if (dialog === 'config') {
        await configureStorefrontCleanup({
          enabled,
          graceSeconds: Number(hours) * 3600,
          revision: data.settings.revision,
          reason,
          confirm: confirmed,
        })
        setMessage('Configuração de limpeza registrada.')
      } else {
        const result = await runStorefrontCleanup()
        setMessage(
          `Limpeza limitada: ${result.claimed} arquivos selecionados, ${result.completed} concluídos, ${result.failed} pendentes de recuperação.`
        )
      }
      setDialog(null)
      setPassword('')
      onCloseLegacy?.()
      await refresh()
    } catch (e) {
      setError(storefrontError(e))
    } finally {
      captcha.current?.reset()
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Box sx={{ mt: 4, mb: 4 }}>
      <Heading as="h2" sx={{ fontSize: 2 }}>
        Manutenção de mídia
      </Heading>
      {error && (
        <Flash variant="danger" sx={{ my: 2 }}>
          {error}
        </Flash>
      )}
      {message && <Flash sx={{ my: 2 }}>{message}</Flash>}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <Text as="p">
            Limpeza automática {data.settings.enabled ? 'habilitada' : 'desligada'} · {data.pending}{' '}
            exclusões pendentes. Arquivos de versões públicas ou em edição são preservados.
          </Text>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button onClick={() => open('config')}>Configurar limpeza</Button>
            <Button disabled={!data.settings.enabled} onClick={() => open('run')}>
              Executar lote limitado
            </Button>
            <Button onClick={refresh}>Atualizar manutenção</Button>
          </Box>
          <details>
            <summary>Últimas operações auditadas</summary>
            {data.events.map((e) => (
              <details key={e.id}>
                <summary>
                  #{e.id} · {e.action} · {e.occurred_at}
                </summary>
                <Text as="p">{e.reason}</Text>
                <Box
                  as="pre"
                  sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 0 }}
                >
                  {JSON.stringify(e.payload, null, 2)}
                </Box>
              </details>
            ))}
          </details>
        </>
      )}
      {dialog && (
        <Dialog
          title={
            dialog === 'legacy'
              ? 'Associar produto legado'
              : dialog === 'config'
                ? 'Configurar limpeza de mídia'
                : 'Executar limpeza limitada'
          }
          onClose={close}
          width="large"
        >
          <Box as="form" onSubmit={save} sx={{ p: 3 }}>
            {dialog === 'legacy' ? (
              <>
                <Text as="p">
                  {legacy?.name}. Não associe sem comprovação de titularidade. Dados e URL original
                  da imagem serão preservados na auditoria; esta ação não publica nem cobra.
                </Text>
                <FormControl>
                  <FormControl.Label>ID da vitrine de destino</FormControl.Label>
                  <TextInput
                    block
                    value={destination}
                    onChange={(e) => {
                      destinationRequest.current++
                      setDestination(e.target.value)
                      setTarget(null)
                      setConfirmed(false)
                    }}
                  />
                </FormControl>
                <Button
                  sx={{ my: 2 }}
                  onClick={async () => {
                    const request = ++destinationRequest.current
                    try {
                      const result = await getLegacyTarget(destination)
                      if (request !== destinationRequest.current) return
                      setTarget(result)
                      setError('')
                    } catch (e) {
                      if (request === destinationRequest.current) setError(storefrontError(e))
                    }
                  }}
                >
                  Verificar destino
                </Button>
                {target && (
                  <Text as="p">
                    Vitrine: {target.name} · titular do destino: {target.ownerId} · revisão{' '}
                    {target.revision}.
                  </Text>
                )}
              </>
            ) : dialog === 'config' ? (
              <>
                <FormControl>
                  <FormControl.Label>Tolerância em horas</FormControl.Label>
                  <TextInput
                    block
                    inputMode="numeric"
                    value={hours}
                    onChange={(e) => {
                      setHours(e.target.value)
                      setConfirmed(false)
                    }}
                  />
                  <FormControl.Caption>
                    De 1 a 720 horas após a perda da última referência. Uploads em andamento possuem
                    proteção adicional.
                  </FormControl.Caption>
                </FormControl>
                <FormControl sx={{ my: 3 }}>
                  <Checkbox
                    checked={enabled}
                    onChange={(e) => {
                      setEnabled(e.target.checked)
                      setConfirmed(false)
                    }}
                  />
                  <FormControl.Label>Habilitar limpeza controlada</FormControl.Label>
                </FormControl>
              </>
            ) : (
              <Text as="p">
                Selecionar no máximo 20 arquivos sem referências, respeitando a tolerância
                configurada. Falhas permanecem rastreáveis para retry.
              </Text>
            )}
            {dialog !== 'run' && (
              <FormControl sx={{ my: 2 }}>
                <FormControl.Label>
                  {dialog === 'legacy'
                    ? 'Referência da evidência de titularidade'
                    : 'Justificativa'}
                </FormControl.Label>
                <Textarea
                  block
                  maxLength={500}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value)
                    setConfirmed(false)
                  }}
                />
              </FormControl>
            )}
            <FormControl>
              <FormControl.Label>Confirme sua senha</FormControl.Label>
              <TextInput
                block
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormControl>
            <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
            <FormControl sx={{ my: 3 }}>
              <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <FormControl.Label>
                Revisei os dados e confirmo esta operação auditada
              </FormControl.Label>
            </FormControl>
            {error && (
              <Flash variant="danger" sx={{ mb: 2 }}>
                {error}
              </Flash>
            )}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button disabled={busy} onClick={close}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={
                  busy ||
                  !confirmed ||
                  !password ||
                  !captchaVerified ||
                  (dialog !== 'run' && reason.trim().length < (dialog === 'legacy' ? 10 : 5)) ||
                  (dialog === 'legacy' && !target) ||
                  (dialog === 'config' && (!/^[1-9][0-9]{0,2}$/.test(hours) || Number(hours) > 720))
                }
              >
                Confirmar operação
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  )
}
