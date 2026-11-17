import StorefrontImage from './StorefrontImage'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import {
  configureAdvertisingPlacement,
  getAdvertisingOperations,
  getAdvertisingCampaigns,
  getAdvertisingInventory,
  resumeAdvertisingCampaign,
  setAdvertisingNetwork,
  adminSuspendAdvertisingCampaign,
} from '../services/advertisingService'
import { reauthenticatePricingAdmin } from '../services/evocashPricingService'
import { AuthCaptcha } from './AuthCaptcha'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'
import { commercialDate, commercialError } from '../utils/commercial'
import { deriveAdStatus } from '../utils/advertisingStatus'
import { placementsSummary } from '../utils/placementLabels'

const OPERATION_LABELS = {
  advertiser_pause: 'Pausado pelo anunciante',
  advertiser_resume: 'Retomado pelo anunciante',
  suspend: 'Suspenso pela administração',
  resume: 'Liberado pela administração',
  approve: 'Aprovado',
  reject: 'Reprovado',
  archive: 'Arquivado',
}

// Aprovar/reprovar campanhas e impulsionamentos vive na fila unificada (ApprovalsQueue.jsx,
// seção Aprovações) -- aqui ficam só os espaços publicitários (capacidade, vendas,
// veiculação, pacote global) e a gestão do que já está aprovado (suspender/retomar
// veiculação), nunca a revisão editorial em si.
export default function AdvertisingAdmin() {
  const [section, setSection] = useState('campaigns')
  const [data, setData] = useState(null)
  const [operations, setOperations] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [form, setForm] = useState({})
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const lock = useRef(false)
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)

  const refresh = useCallback(async () => {
    const [inventory, campaigns] = await Promise.all([
      getAdvertisingInventory(),
      getAdvertisingCampaigns(null),
    ])
    setData({ inventory, campaigns })
  }, [])
  useEffect(() => {
    let live = true
    Promise.all([getAdvertisingInventory(), getAdvertisingCampaigns(null)])
      .then(([inventory, campaigns]) => {
        if (live) setData({ inventory, campaigns })
      })
      .catch((e) => {
        if (live) setError(commercialError(e))
      })
    return () => {
      live = false
    }
  }, [])

  function openDialog(kind, target, values = {}) {
    setDialog({ kind, target })
    setForm({ ...values })
    setReason('')
    setPassword('')
    setError('')
  }

  async function confirm(work) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (reason.trim().length < 5)
        throw new Error('Informe uma justificativa de pelo menos cinco caracteres.')
      await reauthenticatePricingAdmin(password, takeCaptchaToken(captcha))
      await work()
      setDialog(null)
      setPassword('')
      await refresh()
    } catch (e) {
      setError(commercialError(e))
    } finally {
      captcha.current?.reset()
      lock.current = false
      setBusy(false)
    }
  }

  const activeCampaigns = (data?.campaigns || []).filter(
    (c) => c.expires_at && ['approved', 'suspended'].includes(c.moderation_state)
  )

  return (
    <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <Heading as="h2" sx={{ fontSize: 2 }}>
        Publicidade
      </Heading>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, my: 3 }}>
        <Button
          variant={section === 'campaigns' ? 'primary' : 'default'}
          onClick={() => setSection('campaigns')}
        >
          Anúncios publicados
        </Button>
        <Button
          variant={section === 'settings' ? 'primary' : 'default'}
          onClick={() => setSection('settings')}
        >
          Configurações
        </Button>
      </Box>
      <Box hidden={section !== 'settings'}>
        <Heading as="h2" sx={{ fontSize: 2 }}>
          Espaços de anúncio
        </Heading>
        <Text as="p">
          Reduzir o limite de anúncios simultâneos não cancela contratos vigentes. Pausar novas
          contratações preserva a veiculação já contratada; desligar a veiculação gera registro
          operacional.
        </Text>
        {error && <Flash variant="danger">{error}</Flash>}
        {!data && !error && <Spinner />}
        {data?.inventory.placements.map((p) => (
          <Box
            key={`${p.code}:${p.revision}`}
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              p: 3,
              my: 2,
            }}
          >
            <Heading as="h3" sx={{ fontSize: 2 }}>
              {p.name}
            </Heading>
            <Text as="p" sx={{ color: 'fg.muted' }}>
              {p.description}
            </Text>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', my: 2 }}>
              <Label>Limite: {p.capacity} simultâneos</Label>
              <Label>{p.activeContracts || 0} campanhas com contrato vigente</Label>
              <Label variant={p.sales_enabled ? 'success' : 'default'}>
                {p.sales_enabled ? 'Aceitando novas compras' : 'Novas compras desativadas'}
              </Label>
              <Label variant={p.delivery_enabled ? 'success' : 'danger'}>
                {p.delivery_enabled
                  ? 'Exibição dos contratos permitida'
                  : 'Exibição dos contratos desligada'}
              </Label>
            </Box>
            <Button
              disabled={busy}
              onClick={() =>
                openDialog('placement', p, {
                  capacity: String(p.capacity),
                  salesEnabled: p.sales_enabled,
                  deliveryEnabled: p.delivery_enabled,
                })
              }
            >
              Configurar
            </Button>
          </Box>
        ))}
        {data && (
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              p: 3,
              my: 2,
            }}
          >
            <Heading as="h3" sx={{ fontSize: 2 }}>
              Posicionamentos do pacote global
            </Heading>
            <Text as="p" sx={{ color: 'fg.muted' }}>
              Mudanças valem só para novas campanhas; contratos já preparados preservam seu
              conjunto.
            </Text>
            <Text as="p">
              {data.inventory.networkPlacements
                .map((code) => data.inventory.placements.find((p) => p.code === code)?.name || code)
                .join(' · ') || 'Nenhum posicionamento selecionado.'}
            </Text>
            <Button
              disabled={busy}
              onClick={() =>
                openDialog('network', null, { codes: data.inventory.networkPlacements })
              }
            >
              Configurar pacote global
            </Button>
          </Box>
        )}
      </Box>

      <Box hidden={section !== 'campaigns'}>
        <Heading as="h2" sx={{ fontSize: 2, mt: 4 }}>
          Anúncios publicados
        </Heading>
        <Text as="p" sx={{ color: 'fg.muted' }}>
          Aprovação e reprovação de novas campanhas ficam na fila de Aprovações. Aqui só a
          veiculação do que já foi aprovado.
        </Text>
        {data && activeCampaigns.length === 0 && (
          <Text as="p">Nenhum anúncio contratado nesta página.</Text>
        )}
        {activeCampaigns.map((c) => (
          <Box
            key={c.ad_id}
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              p: 3,
              my: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Heading as="h3" sx={{ fontSize: 2, m: 0 }}>
                {c.title}
              </Heading>
              <Label
                variant={
                  c.moderation_state === 'suspended'
                    ? 'danger'
                    : c.advertiser_paused
                      ? 'attention'
                      : 'success'
                }
              >
                {deriveAdStatus(c).label}
              </Label>
            </Box>
            <Text as="p" sx={{ color: 'fg.muted' }}>
              {c.partner_name}
              {c.placements?.length > 0 && ` · ${placementsSummary(c.placements)}`}
            </Text>
            {c.expires_at && (
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
                {commercialDate(c.starts_at)} até {commercialDate(c.expires_at)}
              </Text>
            )}
            {c.media_id && <StorefrontImage id={c.media_id} size={120} />}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 2 }}>
              {c.moderation_state === 'suspended' ? (
                <Button disabled={busy} onClick={() => openDialog('resume', c)}>
                  Liberar anúncio
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => openDialog('suspend', c)}>
                  Suspender anúncio
                </Button>
              )}
            </Box>
          </Box>
        ))}
        {data?.campaigns.length > 0 && data.campaigns.length % 20 === 0 && (
          <Button
            onClick={async () => {
              try {
                const more = await getAdvertisingCampaigns(null, data.campaigns.at(-1).ad_id)
                setData({ ...data, campaigns: [...data.campaigns, ...more] })
              } catch (e) {
                setError(commercialError(e))
              }
            }}
          >
            Carregar mais campanhas
          </Button>
        )}

        <Heading as="h2" sx={{ fontSize: 2, mt: 4 }}>
          Histórico de operações
        </Heading>
        <Button
          sx={{ my: 3 }}
          onClick={async () => {
            try {
              setOperations(operations ? null : await getAdvertisingOperations())
            } catch (e) {
              setError(commercialError(e))
            }
          }}
        >
          {operations ? 'Ocultar histórico' : 'Ver histórico'}
        </Button>
        {operations?.map((o) => (
          <Box key={o.id} sx={{ p: 2, borderBottom: '1px solid', borderColor: 'border.default' }}>
            <Text as="p">
              {OPERATION_LABELS[o.action] || o.action} · {o.reason}
            </Text>
            <Text as="p">{o.occurred_at}</Text>
          </Box>
        ))}
        {operations?.length > 0 && operations.length % 30 === 0 && (
          <Button
            onClick={async () => {
              try {
                setOperations([
                  ...operations,
                  ...(await getAdvertisingOperations(operations.at(-1).id)),
                ])
              } catch (e) {
                setError(commercialError(e))
              }
            }}
          >
            Carregar mais operações
          </Button>
        )}
      </Box>

      {dialog && (
        <Dialog
          title={
            dialog.kind === 'placement'
              ? `Configurar ${dialog.target.name}`
              : dialog.kind === 'network'
                ? 'Pacote global'
                : dialog.kind === 'suspend'
                  ? 'Suspender anúncio'
                  : 'Liberar anúncio'
          }
          onClose={() => {
            if (!busy) setDialog(null)
          }}
          width="large"
        >
          <Box sx={{ p: 3 }}>
            {dialog.kind === 'placement' && (
              <>
                <FormControl sx={{ mb: 2 }} disabled={busy}>
                  <FormControl.Label>Campanhas simultâneas por contexto</FormControl.Label>
                  <TextInput
                    block
                    inputMode="numeric"
                    value={form.capacity ?? ''}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                  />
                </FormControl>
                <FormControl sx={{ mb: 2 }} disabled={busy}>
                  <Checkbox
                    checked={Boolean(form.salesEnabled)}
                    onChange={(e) => setForm({ ...form, salesEnabled: e.target.checked })}
                  />
                  <FormControl.Label>Aceitar novas contratações</FormControl.Label>
                  <FormControl.Caption>
                    Controla só a venda de novos períodos. Não afeta contratos já vigentes.
                  </FormControl.Caption>
                </FormControl>
                <FormControl sx={{ mb: 2 }} disabled={busy}>
                  <Checkbox
                    checked={Boolean(form.deliveryEnabled)}
                    onChange={(e) => setForm({ ...form, deliveryEnabled: e.target.checked })}
                  />
                  <FormControl.Label>Permitir exibição</FormControl.Label>
                  <FormControl.Caption>
                    Controla a entrega dos anúncios já aprovados neste espaço.
                  </FormControl.Caption>
                </FormControl>
                {!form.deliveryEnabled && dialog.target.activeContracts > 0 && (
                  <Flash variant="warning" sx={{ mb: 2 }}>
                    <Text as="p">
                      Desligar a exibição interrompe {dialog.target.activeContracts} campanha(s) com
                      contrato vigente. Nenhum estorno ou prazo adicional é automático.
                    </Text>
                    {dialog.target.affectedCampaigns?.map((campaign) => (
                      <Text as="p" key={campaign.id}>
                        {campaign.title} · {campaign.id}
                      </Text>
                    ))}
                    {dialog.target.activeContracts >
                      (dialog.target.affectedCampaigns?.length || 0) && (
                      <Text as="p">A lista mostra apenas as primeiras 20 campanhas afetadas.</Text>
                    )}
                  </Flash>
                )}
              </>
            )}
            {dialog.kind === 'network' && (
              <>
                {data.inventory.placements
                  .filter((p) => ['banner', 'feed'].includes(p.content_type))
                  .map((p) => (
                    <FormControl key={p.code} sx={{ mb: 2 }} disabled={busy}>
                      <Checkbox
                        checked={(form.codes || []).includes(p.code)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            codes: e.target.checked
                              ? [...(form.codes || []), p.code]
                              : (form.codes || []).filter((c) => c !== p.code),
                          })
                        }
                      />
                      <FormControl.Label>{p.name}</FormControl.Label>
                    </FormControl>
                  ))}
              </>
            )}
            {(dialog.kind === 'suspend' || dialog.kind === 'resume') && (
              <Text as="p">
                {dialog.target.title} · {dialog.target.partner_name}
              </Text>
            )}
            <FormControl sx={{ mt: 2 }} required disabled={busy}>
              <FormControl.Label>Justificativa da operação</FormControl.Label>
              <TextInput
                block
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormControl>
            <FormControl sx={{ mt: 2 }} required disabled={busy}>
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
            {error && (
              <Flash variant="danger" sx={{ mt: 2 }}>
                {error}
              </Flash>
            )}
            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              <Button disabled={busy} onClick={() => setDialog(null)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  reason.trim().length < 5 ||
                  !password ||
                  !captchaVerified ||
                  (dialog.kind === 'placement' && !/^(0|[1-9][0-9]?|100)$/.test(form.capacity))
                }
                onClick={() =>
                  confirm(() => {
                    if (dialog.kind === 'placement')
                      return configureAdvertisingPlacement(dialog.target, { ...form, reason })
                    if (dialog.kind === 'network')
                      return setAdvertisingNetwork(
                        form.codes || [],
                        data.inventory.networkRevision,
                        reason
                      )
                    if (dialog.kind === 'suspend')
                      return adminSuspendAdvertisingCampaign(dialog.target.ad_id, reason)
                    return resumeAdvertisingCampaign(
                      dialog.target.ad_id,
                      dialog.target.approved_version,
                      reason
                    )
                  })
                }
              >
                {busy ? 'Enviando…' : 'Confirmar'}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  )
}
