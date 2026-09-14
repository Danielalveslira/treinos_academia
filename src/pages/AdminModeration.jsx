import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Flash,
  FormControl,
  Heading,
  Label,
  Select,
  Spinner,
  Text,
  Textarea,
  TextInput,
} from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useSupport } from '../hooks/useSupport'
import { decideSupportRequest, getModerationEvidenceBlob } from '../services/supportService'
import { formatDateTime } from '../utils/format'

// AUD-007: a página só imprimia contentSnapshot como JSON cru -- photoPath nunca
// virava imagem, então um relato contra uma foto (mesmo com a evidência preservada
// no Storage, ver submitSupportRequest) não dava pra ver de fato. Componente próprio
// e minimalista (sem cache/retry de useStatusPhoto -- essa página é de baixo tráfego,
// um moderador olhando um relato de cada vez) em vez de reaproveitar aquele hook.
function EvidencePhoto({ evidencePath }) {
  const [state, setState] = useState({ url: null, loading: true, error: false })
  useEffect(() => {
    let active = true
    setState({ url: null, loading: true, error: false })
    getModerationEvidenceBlob(evidencePath)
      .then((blob) => {
        if (active) setState({ url: URL.createObjectURL(blob), loading: false, error: false })
      })
      .catch(() => {
        if (active) setState({ url: null, loading: false, error: true })
      })
    return () => {
      active = false
    }
  }, [evidencePath])
  useEffect(() => () => state.url && URL.revokeObjectURL(state.url), [state.url])
  if (state.loading) return <Spinner aria-label="Carregando evidência" />
  if (state.error || !state.url)
    return <Text sx={{ color: 'fg.muted' }}>Evidência indisponível.</Text>
  return <img src={state.url} alt="Foto denunciada" className="support-evidence-photo" />
}

const ACTIONS = {
  no_action: 'Responder sem penalidade',
  warning: 'Advertência',
  remove_content: 'Remover publicação',
  temporary_suspension: 'Suspensão temporária do sistema',
  community_ban: 'Banimento da comunidade',
  system_ban: 'Banimento do sistema',
  restore: 'Revogar restrição',
}

const KIND_LABELS = {
  report: 'Denúncia',
  appeal: 'Recurso',
  privacy: 'Privacidade/exclusão',
}

const STATE_LABELS = {
  open: { text: 'Em análise', variant: 'attention' },
  closed: { text: 'Respondido', variant: 'success' },
}

export default function AdminModeration() {
  const { user } = useAuth()
  const [state, setState] = useState('open')
  const {
    requests,
    loading,
    hasMore,
    loadMore,
    error: loadError,
    refresh,
  } = useSupport(user.uid, true, state)
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function select(item) {
    setSelected(item)
    setDraft({
      action: 'no_action',
      targetUserId: item.contentSnapshot?.authorId || (item.kind === 'appeal' ? item.userId : ''),
      communityId: item.communityId || '',
      days: 7,
      rule: '',
      evidence: '',
      reason: '',
    })
    setError('')
  }
  function edit(field, value) {
    setDraft((previous) => ({ ...previous, [field]: value }))
  }
  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await decideSupportRequest({ requestId: selected.id, ...draft, days: Number(draft.days) })
      setSelected(null)
      await refresh()
    } catch (err) {
      setError(
        [
          'functions/failed-precondition',
          'functions/invalid-argument',
          'functions/not-found',
        ].includes(err?.code)
          ? err.message
          : 'Não foi possível registrar a decisão. Confira os dados e tente novamente.'
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="support-page">
      <h1>Atendimento e moderação</h1>
      <p>
        Decisões exigem regra, evidências e fundamentação. Remoções e restrições são aplicadas ao
        confirmar o formulário.
      </p>
      {!selected && (
        <FormControl sx={{ mb: 3 }}>
          <FormControl.Label>Mostrar pedidos</FormControl.Label>
          <Select value={state} onChange={(event) => setState(event.target.value)}>
            <Select.Option value="open">Em análise</Select.Option>
            <Select.Option value="closed">Respondidos</Select.Option>
            <Select.Option value="">Todos</Select.Option>
          </Select>
        </FormControl>
      )}
      {loading && <Spinner aria-label="Carregando pedidos" />}
      {loadError && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {loadError} <Button onClick={refresh}>Tentar novamente</Button>
        </Flash>
      )}
      {!selected &&
        requests.map((item) => (
          <Box
            as="article"
            key={item.id}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              p: 3,
              mb: 3,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: 2,
              }}
            >
              <Box>
                <Heading as="h2" sx={{ fontSize: 1 }}>
                  {KIND_LABELS[item.kind] || item.kind}
                </Heading>
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                  Protocolo {item.id} · {formatDateTime(item.createdAt?.toDate())}
                </Text>
              </Box>
              <Label variant={STATE_LABELS[item.state]?.variant}>
                {STATE_LABELS[item.state]?.text || item.state}
              </Label>
            </Box>
            <Link to={`/admin/contas?usuario=${encodeURIComponent(item.userId)}`}>
              Ver conta do solicitante
            </Link>
            <Text as="p" className="support-message" sx={{ m: 0 }}>
              {item.message}
            </Text>
            {item.response && (
              <Box
                sx={{
                  borderLeft: '3px solid',
                  borderColor: 'success.emphasis',
                  bg: 'success.subtle',
                  borderRadius: 1,
                  p: 2,
                }}
              >
                <Text as="p" sx={{ fontWeight: 'bold', fontSize: 0, m: 0 }}>
                  Resposta enviada
                  {item.decidedAt ? ` em ${formatDateTime(item.decidedAt.toDate())}` : ''}
                </Text>
                <Text as="p" className="support-message" sx={{ m: 0 }}>
                  {item.response}
                </Text>
              </Box>
            )}
            {item.state === 'open' && (
              <Button onClick={() => select(item)} sx={{ alignSelf: 'flex-start' }}>
                Analisar pedido
              </Button>
            )}
          </Box>
        ))}
      {!selected && hasMore && (
        <Button onClick={loadMore} disabled={loading}>
          Carregar mais pedidos
        </Button>
      )}
      {selected && (
        <form className="support-form" onSubmit={submit}>
          <h2>Decisão do pedido {selected.id}</h2>
          <p className="support-message">{selected.message}</p>
          {selected.evidencePath && <EvidencePhoto evidencePath={selected.evidencePath} />}
          {selected.contentSnapshot && (
            <details>
              <summary>Conteúdo preservado</summary>
              <pre className="support-evidence">
                {JSON.stringify(selected.contentSnapshot, null, 2)}
              </pre>
            </details>
          )}
          {error && (
            <Flash variant="danger" role="alert">
              {error}
            </Flash>
          )}
          <FormControl disabled={saving}>
            <FormControl.Label>Medida</FormControl.Label>
            <Select value={draft.action} onChange={(e) => edit('action', e.target.value)} block>
              {Object.entries(ACTIONS)
                .filter(
                  ([value]) => ['report', 'appeal'].includes(selected.kind) || value === 'no_action'
                )
                .map(([value, label]) => (
                  <Select.Option key={value} value={value}>
                    {label}
                  </Select.Option>
                ))}
            </Select>
          </FormControl>
          {['targetUserId', 'communityId'].map((field) => (
            <FormControl disabled={saving} key={field}>
              <FormControl.Label>
                {field === 'targetUserId'
                  ? 'ID do usuário atingido'
                  : 'ID da comunidade (em branco para todo o sistema)'}
              </FormControl.Label>
              <TextInput block value={draft[field]} onChange={(e) => edit(field, e.target.value)} />
            </FormControl>
          ))}
          {draft.action === 'temporary_suspension' && (
            <FormControl required disabled={saving}>
              <FormControl.Label>Prazo em dias (1 a 30)</FormControl.Label>
              <TextInput
                block
                type="number"
                min={1}
                max={30}
                required
                value={draft.days}
                onChange={(e) => edit('days', e.target.value)}
              />
            </FormControl>
          )}
          {[
            ['rule', 'Regra ou fundamento do atendimento'],
            ['evidence', 'Evidências e verificação realizada (restritas à administração)'],
            ['reason', 'Fundamentação e resposta ao usuário'],
          ].map(([field, label]) => (
            <FormControl required disabled={saving} key={field}>
              <FormControl.Label>{label}</FormControl.Label>
              <Textarea
                block
                required
                minLength={5}
                maxLength={3000}
                rows={4}
                value={draft[field]}
                onChange={(e) => edit(field, e.target.value)}
              />
            </FormControl>
          ))}
          <div className="community-form-actions">
            <Button type="button" disabled={saving} onClick={() => setSelected(null)}>
              Voltar
            </Button>
            <Button type="submit" variant="primary" disabled={saving} loading={saving}>
              Confirmar decisão e aplicar medida
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
