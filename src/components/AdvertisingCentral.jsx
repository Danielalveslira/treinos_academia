import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Flash,
  FormControl,
  Heading,
  Select,
  Spinner,
  Text,
  Textarea,
  TextInput,
} from '@primer/react'
import {
  createAdvertisingCampaign,
  archiveAdvertisingCampaign,
  editAdvertisingCampaign,
  getAdvertisingCampaigns,
  interruptAdvertisingCampaign,
  getAdvertisingRevisions,
} from '../services/advertisingService'
import StorefrontImage from './StorefrontImage'
import { uploadStorefrontImage } from '../services/storefrontService'
import CommercialLeasePurchase from './CommercialLeasePurchase'
import CommercialOrderHistory from './CommercialOrderHistory'
import CommunityAdvertisingPermissions from './CommunityAdvertisingPermissions'
import { getAdvertisingOrders } from '../services/advertisingService'
import { listActiveCommunities } from '../services/communitiesService'
import { useAuth } from '../hooks/useAuth'
import { commercialDate } from '../utils/commercial'

const EMPTY = {
  title: '',
  description: '',
  destination: '',
  placement: 'home_banner',
  communityId: '',
}
const labels = {
  draft: 'Rascunho',
  submitted: 'Em análise',
  approved: 'Aprovada',
  rejected: 'Reprovada',
  archived: 'Arquivada',
  suspended: 'Interrompida',
}
function ContentFields({ values, setValues, disabled }) {
  return (
    <>
      <FormControl disabled={disabled} required>
        <FormControl.Label>Nome e título do anúncio</FormControl.Label>
        <TextInput
          block
          maxLength={100}
          value={values.title}
          onChange={(e) => setValues({ ...values, title: e.target.value })}
        />
      </FormControl>
      <FormControl disabled={disabled}>
        <FormControl.Label>Texto publicitário</FormControl.Label>
        <Textarea
          block
          maxLength={500}
          value={values.description}
          onChange={(e) => setValues({ ...values, description: e.target.value })}
        />
      </FormControl>
      <FormControl disabled={disabled} required>
        <FormControl.Label>Destino HTTPS</FormControl.Label>
        <TextInput
          block
          type="url"
          maxLength={300}
          placeholder="https://sua-empresa.com.br"
          value={values.destination}
          onChange={(e) => setValues({ ...values, destination: e.target.value })}
        />
      </FormControl>
    </>
  )
}
function Campaign({ campaign, onChange }) {
  const [showHistory, setShowHistory] = useState(false)
  const [revisions, setRevisions] = useState(null)
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState(campaign)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  async function act(suspend) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (suspend)
        await interruptAdvertisingCampaign(campaign.ad_id, 'Interrupção solicitada pelo anunciante')
      else await editAdvertisingCampaign(campaign, values, true)
      setEditing(false)
      await onChange()
    } catch (e) {
      setError(e.message || 'Não foi possível salvar. Atualize e tente novamente.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        my: 3,
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      <Heading as="h3" sx={{ fontSize: 2 }}>
        {campaign.title}
      </Heading>
      <Text as="p">
        {labels[campaign.state]} · {labels[campaign.moderation_state] || campaign.moderation_state}
      </Text>
      <Text as="p">
        {campaign.delivery_state === 'active'
          ? 'Em veiculação'
          : campaign.delivery_state === 'expired'
            ? 'Período vencido'
            : 'Sem veiculação autorizada'}
        {campaign.remaining_seconds > 0
          ? ` · ${Math.ceil(campaign.remaining_seconds / 86400)} dias restantes`
          : ''}
      </Text>
      <Text as="p">{campaign.placements?.map((p) => p.code).join(' · ')}</Text>
      <Button
        sx={{ my: 2 }}
        onClick={async () => {
          try {
            setRevisions(revisions ? null : await getAdvertisingRevisions(campaign.ad_id))
          } catch (e) {
            setError(e.message)
          }
        }}
      >
        Histórico do material
      </Button>
      {revisions?.map((v) => (
        <Box key={v.version} sx={{ p: 2, bg: 'canvas.subtle', my: 2 }}>
          <Text as="p">
            Revisão {v.version}: {v.title}
          </Text>
          <Text as="p">{v.description}</Text>
          <Text as="p">Destino: {v.destination}</Text>
        </Box>
      ))}
      {campaign.review_reason && <Text as="p">Decisão editorial: {campaign.review_reason}</Text>}
      {campaign.expires_at && (
        <Text as="p">
          {commercialDate(campaign.starts_at)} até {commercialDate(campaign.expires_at)}
        </Text>
      )}
      {error && <Flash variant="danger">{error}</Flash>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <Button disabled={busy} onClick={() => setEditing(!editing)}>
          Preparar revisão
        </Button>
        <Button
          disabled={busy || campaign.moderation_state === 'suspended'}
          onClick={() => act(true)}
        >
          Interromper veiculação
        </Button>
        <Button
          disabled={busy || campaign.state === 'archived'}
          onClick={async () => {
            if (lock.current) return
            lock.current = true
            setBusy(true)
            try {
              await archiveAdvertisingCampaign(campaign.ad_id)
              await onChange()
            } catch (e) {
              setError(e.message)
            } finally {
              lock.current = false
              setBusy(false)
            }
          }}
        >
          Arquivar campanha
        </Button>
      </Box>
      {campaign.can_pay && (
        <Button sx={{ mt: 2 }} onClick={() => setShowHistory(!showHistory)}>
          Histórico de contratações
        </Button>
      )}
      {showHistory && (
        <CommercialOrderHistory resourceId={campaign.ad_id} load={getAdvertisingOrders} />
      )}
      {editing && (
        <Box sx={{ mt: 3 }}>
          <FormControl disabled={busy}>
            <FormControl.Label>Imagem da campanha (opcional)</FormControl.Label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file || lock.current) return
                lock.current = true
                setBusy(true)
                setError('')
                try {
                  const media_id = await uploadStorefrontImage(campaign.ad_id, file)
                  setValues((v) => ({ ...v, media_id }))
                } catch (error) {
                  setError(error.message || 'Falha no envio da imagem.')
                } finally {
                  lock.current = false
                  setBusy(false)
                }
              }}
            />
          </FormControl>
          <ContentFields values={values} setValues={setValues} disabled={busy} />
          <Box
            sx={{ my: 3, p: 2, bg: 'canvas.subtle', borderRadius: 2 }}
            aria-label="Prévia do material em revisão"
          >
            <Text as="p">Publicidade · {campaign.partner_name}</Text>
            {values.media_id && <StorefrontImage id={values.media_id} size={160} />}
            <Text as="p" sx={{ fontWeight: 'bold' }}>
              {values.title}
            </Text>
            <Text as="p">{values.description}</Text>
            <Text as="p">Destino: {values.destination}</Text>
          </Box>
          <Button
            variant="primary"
            disabled={busy || !values.title.trim() || !values.destination.startsWith('https://')}
            onClick={() => act(false)}
          >
            Salvar e enviar à moderação
          </Button>
        </Box>
      )}
      {campaign.can_pay && campaign.moderation_state === 'approved' && (
        <CommercialLeasePurchase
          resourceId={campaign.ad_id}
          resourceName={campaign.title}
          subjectLabel="anúncio"
          tariff={campaign.tariff}
          expiresAt={campaign.expires_at}
          onComplete={onChange}
        />
      )}
    </Box>
  )
}
export default function AdvertisingCentral({ accountId }) {
  const { user } = useAuth()
  const [communities, setCommunities] = useState([])
  useEffect(() => {
    let live = true
    listActiveCommunities(user?.uid)
      .then((rows) => {
        if (live) setCommunities(rows)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [user?.uid])
  const [rows, setRows] = useState(null)
  const [values, setValues] = useState(EMPTY)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const intent = useRef(null)
  const lock = useRef(false)
  const refresh = useCallback(
    async () => setRows(await getAdvertisingCampaigns(accountId)),
    [accountId]
  )
  useEffect(() => {
    let live = true
    getAdvertisingCampaigns(accountId)
      .then((data) => {
        if (live) setRows(data)
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [accountId])
  async function create(e) {
    e.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      intent.current ||= crypto.randomUUID()
      await createAdvertisingCampaign(accountId, values, intent.current)
      intent.current = null
      setValues(EMPTY)
      setCreating(false)
      await refresh()
    } catch (err) {
      setError(err.message || 'Falha ao criar campanha.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Box sx={{ mt: 3, minWidth: 0 }}>
      <Heading as="h2" sx={{ fontSize: 2 }}>
        Central de publicidade
      </Heading>
      <Text as="p">
        Prepare o material gratuitamente. Após aprovação, consulte preço e disponibilidade e
        autorize o débito da sua carteira pessoal.
      </Text>
      <Text as="p">
        A contratação garante o período e os posicionamentos confirmados, sem quantidade mínima de
        visualizações ou cliques. Não há renovação automática.
      </Text>
      {error && <Flash variant="danger">{error}</Flash>}
      <Button onClick={() => setCreating(!creating)}>Nova campanha</Button>
      {creating && (
        <Box as="form" onSubmit={create} sx={{ mt: 3 }}>
          <ContentFields
            values={values}
            setValues={(next) => {
              setValues(next)
              intent.current = null
            }}
            disabled={busy}
          />
          <FormControl disabled={busy}>
            <FormControl.Label>Onde anunciar</FormControl.Label>
            <Select
              block
              value={values.placement}
              onChange={(e) => {
                setValues({ ...values, placement: e.target.value })
                intent.current = null
              }}
            >
              <Select.Option value="home_banner">Home</Select.Option>
              <Select.Option value="community_banner">Banner da sua comunidade</Select.Option>
              <Select.Option value="community_feed">Feed da sua comunidade</Select.Option>
              <Select.Option value="network">Pacote de posicionamentos aprovado</Select.Option>
            </Select>
          </FormControl>
          {values.placement !== 'home_banner' && (
            <FormControl disabled={busy}>
              <FormControl.Label>Comunidade autorizada</FormControl.Label>
              <Select
                block
                value={values.communityId}
                onChange={(e) => {
                  setValues({ ...values, communityId: e.target.value })
                  intent.current = null
                }}
              >
                <Select.Option value="">Selecione sua comunidade</Select.Option>
                {communities.map((c) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
          )}
          <Button
            type="submit"
            variant="primary"
            sx={{ mt: 2 }}
            disabled={busy || !values.title.trim() || !values.destination.startsWith('https://')}
          >
            Salvar rascunho
          </Button>
        </Box>
      )}
      {values.communityId && (
        <CommunityAdvertisingPermissions
          key={values.communityId}
          communityId={values.communityId}
        />
      )}
      {!rows && !error && <Spinner aria-label="Carregando campanhas" />}
      {rows?.map((row) => (
        <Campaign
          key={`${row.ad_id}:${row.version}:${row.moderation_state}`}
          campaign={row}
          onChange={refresh}
        />
      ))}
      {rows?.length === 0 && <Text as="p">Nenhuma campanha preparada.</Text>}
      {rows?.length > 0 && rows.length % 20 === 0 && (
        <Button
          onClick={async () => {
            try {
              const more = await getAdvertisingCampaigns(accountId, rows.at(-1).ad_id)
              setRows([...rows, ...more])
            } catch (e) {
              setError(e.message)
            }
          }}
        >
          Carregar mais campanhas
        </Button>
      )}
    </Box>
  )
}
