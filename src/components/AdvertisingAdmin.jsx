import StorefrontImage from './StorefrontImage'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Flash,
  FormControl,
  Heading,
  Spinner,
  Text,
  TextInput,
} from '@primer/react'
import {
  configureAdvertisingPlacement,
  getAdvertisingOperations,
  getAdvertisingCampaigns,
  getAdvertisingInventory,
  getCommercialPromotions,
  reviewCommercialPromotion,
  resumeAdvertisingCampaign,
  setAdvertisingNetwork,
  interruptAdvertisingCampaign,
  reviewAdvertisingCampaign,
} from '../services/advertisingService'
import { reauthenticatePricingAdmin } from '../services/evocashPricingService'
function Placement({ placement, onSave, busy }) {
  const [capacity, setCapacity] = useState(String(placement.capacity))
  const [salesEnabled, setSalesEnabled] = useState(placement.sales_enabled)
  const [deliveryEnabled, setDeliveryEnabled] = useState(placement.delivery_enabled)
  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'border.default', py: 3 }}>
      <Heading as="h3" sx={{ fontSize: 2 }}>
        {placement.name}
      </Heading>
      <Text as="p">{placement.description}</Text>
      <FormControl disabled={busy}>
        <FormControl.Label>Campanhas simultâneas por contexto</FormControl.Label>
        <TextInput
          block
          inputMode="numeric"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
      </FormControl>
      <FormControl disabled={busy}>
        <Checkbox checked={salesEnabled} onChange={(e) => setSalesEnabled(e.target.checked)} />
        <FormControl.Label>Aceitar novas contratações</FormControl.Label>
      </FormControl>
      <FormControl disabled={busy}>
        <Checkbox
          checked={deliveryEnabled}
          onChange={(e) => setDeliveryEnabled(e.target.checked)}
        />
        <FormControl.Label>Veiculação disponível</FormControl.Label>
      </FormControl>
      <Button
        sx={{ mt: 2 }}
        disabled={busy || !/^(0|[1-9][0-9]?|100)$/.test(capacity)}
        onClick={() => onSave(placement, { capacity, salesEnabled, deliveryEnabled })}
      >
        Confirmar configuração
      </Button>
    </Box>
  )
}
export default function AdvertisingAdmin() {
  const [data, setData] = useState(null)
  const [operations, setOperations] = useState(null)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const refresh = useCallback(async () => {
    const [inventory, campaigns, promotions] = await Promise.all([
      getAdvertisingInventory(),
      getAdvertisingCampaigns(null),
      getCommercialPromotions(),
    ])
    setData({ inventory, campaigns, promotions })
  }, [])
  useEffect(() => {
    let live = true
    Promise.all([
      getAdvertisingInventory(),
      getAdvertisingCampaigns(null),
      getCommercialPromotions(),
    ])
      .then(([inventory, campaigns, promotions]) => {
        if (live) setData({ inventory, campaigns, promotions })
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [])
  async function action(work) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (reason.trim().length < 5)
        throw Error('Informe uma justificativa de pelo menos cinco caracteres.')
      await reauthenticatePricingAdmin(password)
      setPassword('')
      await work()
      await refresh()
    } catch (e) {
      setError(e.message || 'Operação não concluída.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <Heading as="h2" sx={{ fontSize: 2 }}>
        Publicidade autônoma
      </Heading>
      <Text as="p">
        Preços, pedidos, direitos e reversões permanecem na aba Motor comercial. Reduzir capacidade
        não pode invalidar contratos existentes. Pausar vendas preserva veiculação; desligar
        veiculação gera registro operacional.
      </Text>
      {error && <Flash variant="danger">{error}</Flash>}
      <FormControl disabled={busy} required>
        <FormControl.Label>Justificativa da operação</FormControl.Label>
        <TextInput
          block
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormControl>
      <FormControl disabled={busy} required>
        <FormControl.Label>Senha para autenticação recente</FormControl.Label>
        <TextInput
          block
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </FormControl>
      {!data && !error && <Spinner />}
      {data?.inventory.placements.map((p) => (
        <Placement
          key={`${p.code}:${p.revision}`}
          placement={p}
          busy={busy}
          onSave={(placement, values) =>
            action(() => configureAdvertisingPlacement(placement, { ...values, reason }))
          }
        />
      ))}
      {data && (
        <Network
          key={data.inventory.networkRevision}
          inventory={data.inventory}
          busy={busy}
          onSave={(codes) =>
            action(() => setAdvertisingNetwork(codes, data.inventory.networkRevision, reason))
          }
        />
      )}
      <Heading as="h2" sx={{ fontSize: 2, mt: 3 }}>
        Revisões e campanhas
      </Heading>
      {data?.campaigns.map((c) => (
        <Box
          key={c.ad_id}
          sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, my: 2 }}
        >
          <Heading as="h3" sx={{ fontSize: 2 }}>
            {c.title}
          </Heading>
          <Text as="p">
            {c.partner_name} · Revisão {c.version} · {c.state} · {c.moderation_state}
          </Text>
          <Text as="p">{c.description}</Text>
          {c.media_id && <StorefrontImage id={c.media_id} size={160} />}
          <Text as="p">Destino: {c.destination}</Text>
          <Text as="p">{c.placements?.map((p) => p.code).join(' · ')}</Text>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Button
              disabled={busy || c.state !== 'submitted'}
              onClick={() => action(() => reviewAdvertisingCampaign(c, true, reason))}
            >
              Aprovar revisão
            </Button>
            <Button
              disabled={busy || c.state !== 'submitted'}
              onClick={() => action(() => reviewAdvertisingCampaign(c, false, reason))}
            >
              Reprovar revisão
            </Button>
            {c.moderation_state === 'suspended' && (
              <Button
                disabled={busy}
                onClick={() =>
                  action(() => resumeAdvertisingCampaign(c.ad_id, c.approved_version, reason))
                }
              >
                Retomar material aprovado
              </Button>
            )}
            <Button
              disabled={busy || c.moderation_state === 'suspended'}
              onClick={() => action(() => interruptAdvertisingCampaign(c.ad_id, reason))}
            >
              Suspender veiculação
            </Button>
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
              setError(e.message)
            }
          }}
        >
          Carregar mais campanhas
        </Button>
      )}
      <Heading as="h2" sx={{ fontSize: 2, mt: 3 }}>
        Impulsionamentos
      </Heading>
      <Button
        sx={{ my: 3 }}
        onClick={async () => {
          try {
            setOperations(operations ? null : await getAdvertisingOperations())
          } catch (e) {
            setError(e.message)
          }
        }}
      >
        Histórico operacional
      </Button>
      {operations?.map((o) => (
        <Box key={o.id} sx={{ p: 2, borderBottom: '1px solid', borderColor: 'border.default' }}>
          <Text as="p">
            {o.action} · {o.reason}
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
              setError(e.message)
            }
          }}
        >
          Carregar mais operações
        </Button>
      )}
      {data?.promotions.map((p) => (
        <Box
          key={p.id}
          sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, my: 2 }}
        >
          <Text as="h3">{p.title || 'Conteúdo original indisponível'}</Text>
          <Text as="p">
            {p.target_type === 'post' ? 'Publicação' : 'Comunidade'} · {p.moderation_state}
          </Text>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Button
              disabled={busy || p.moderation_state !== 'submitted'}
              onClick={() => action(() => reviewCommercialPromotion(p.id, true, reason))}
            >
              Aprovar impulsionamento
            </Button>
            <Button
              disabled={busy || p.moderation_state !== 'submitted'}
              onClick={() => action(() => reviewCommercialPromotion(p.id, false, reason))}
            >
              Reprovar impulsionamento
            </Button>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
function Network({ inventory, busy, onSave }) {
  const [codes, setCodes] = useState(inventory.networkPlacements)
  return (
    <Box sx={{ my: 3 }}>
      <Heading as="h3" sx={{ fontSize: 2 }}>
        Posicionamentos do pacote global
      </Heading>
      <Text as="p">
        Mudanças serão aplicadas somente às novas campanhas. Os contratos e campanhas já preparados
        preservam seu conjunto.
      </Text>
      {inventory.placements
        .filter((p) => ['banner', 'feed'].includes(p.content_type))
        .map((p) => (
          <FormControl key={p.code} disabled={busy}>
            <Checkbox
              checked={codes.includes(p.code)}
              onChange={(e) =>
                setCodes(e.target.checked ? [...codes, p.code] : codes.filter((c) => c !== p.code))
              }
            />
            <FormControl.Label>{p.name}</FormControl.Label>
          </FormControl>
        ))}
      <Button disabled={busy} onClick={() => onSave(codes)}>
        Confirmar pacote global
      </Button>
    </Box>
  )
}
