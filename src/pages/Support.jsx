import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
  useConfirm,
} from '@primer/react'
import { PublicLayout } from '../components/PublicLayout'
import { useAuth } from '../hooks/useAuth'
import { useSingleFlight } from '../hooks/useSingleFlight'
import { useSupport } from '../hooks/useSupport'
import { submitSupportRequest, cancelSupportRequest } from '../services/supportService'
import { getPublishedProfessionalListing } from '../services/professionalListingsService'
import { REPORT_CATEGORY_OPTIONS } from '../constants/supportReportCategories'
import { LEGAL_MANIFEST } from '../utils/legal'
import { formatDateTime } from '../utils/format'
import { toDate } from '../utils/date'

const KINDS = {
  report: 'Denunciar violação',
  appeal: 'Recorrer de uma decisão',
  privacy: 'Privacidade ou exclusão da conta',
}

const STATE_LABELS = {
  open: { text: 'Em análise', variant: 'attention' },
  closed: { text: 'Respondido', variant: 'success' },
}

export default function Support() {
  const { user } = useAuth()
  const confirm = useConfirm()
  const [params] = useSearchParams()
  const [cancelingId, setCancelingId] = useState(null)
  const [kind, setKind] = useState(
    Object.hasOwn(KINDS, params.get('tipo')) ? params.get('tipo') : 'report'
  )
  const [message, setMessage] = useState('')
  const [statusId, setStatusId] = useState(params.get('publicacao') || '')
  const [listingId] = useState(params.get('vitrine') || '')
  const [listingContext, setListingContext] = useState(null)
  const [category, setCategory] = useState('')
  const [communityId, setCommunityId] = useState(params.get('comunidade') || '')
  const [decisionId, setDecisionId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const {
    requests,
    notices,
    hasMore,
    loadMore,
    loading,
    error: loadError,
    refresh,
  } = useSupport(user?.uid)

  // Contexto automático do alvo denunciado -- o usuário não digita qual vitrine está
  // denunciando, o botão na própria vitrine já manda o id pela URL; aqui só resolve um
  // nome amigável pra confirmar visualmente. Melhor esforço: se a vitrine já não estiver
  // mais pública (ex.: suspensa), a denúncia continua válida mesmo sem esse nome.
  useEffect(() => {
    if (!listingId) return
    let active = true
    getPublishedProfessionalListing(listingId)
      .then((listing) => {
        if (active) setListingContext(listing)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [listingId])

  const cancelFlight = useSingleFlight()

  function handleCancel(item) {
    return cancelFlight.run(item.id, () => cancelRequest(item))
  }

  async function cancelRequest(item) {
    const confirmed = await confirm({
      title: 'Cancelar este pedido?',
      content: 'O pedido será encerrado e não poderá mais ser analisado.',
      confirmButtonContent: 'Cancelar pedido',
      confirmButtonType: 'danger',
      cancelButtonContent: 'Voltar',
    })
    if (!confirmed) return
    setCancelingId(item.id)
    try {
      await cancelSupportRequest(item.id)
      await refresh()
    } catch {
      setError('Não foi possível cancelar o pedido. Tente novamente.')
    } finally {
      setCancelingId(null)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    if (message.trim().length < 10) {
      setError('Descreva o pedido usando pelo menos 10 caracteres.')
      return
    }
    if (kind === 'report' && !category) {
      setError('Selecione uma categoria para a denúncia.')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const result = await submitSupportRequest({
        kind,
        message,
        statusId: kind === 'report' ? statusId : '',
        listingId: kind === 'report' ? listingId : '',
        category: kind === 'report' ? category : '',
        communityId: kind === 'report' ? communityId : '',
        decisionId: kind === 'appeal' ? decisionId : '',
      })
      setSuccess(`Pedido registrado. Protocolo: ${result.id}.`)
      setMessage('')
      setCategory('')
      await refresh()
    } catch (err) {
      if (err.code === 'functions/resource-exhausted') {
        setError('Aguarde um minuto antes de enviar outro pedido.')
      } else if (err.code === 'functions/permission-denied' && err.message) {
        // Mensagens de permission-denied do submitSupportRequest já são seguras para
        // exibir (ex.: sem acesso à publicação, autor administrativo não denunciável).
        setError(err.message)
      } else {
        setError(
          'Não foi possível registrar o pedido. O texto foi mantido. Tente novamente ou utilize o e-mail de contato.'
        )
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <PublicLayout>
      <div className="support-page">
        <h1>Atendimento</h1>
        <p>Denúncias, recursos e privacidade em um canal privado.</p>
        {LEGAL_MANIFEST.contactEmail && (
          <p>
            Você também pode escrever para{' '}
            <a href={`mailto:${LEGAL_MANIFEST.contactEmail}`}>{LEGAL_MANIFEST.contactEmail}</a>,
            inclusive se não conseguir entrar na conta.
          </p>
        )}
        {!LEGAL_MANIFEST.published && (
          <Flash variant="warning">
            Canal em preparação junto às minutas. A disponibilidade será confirmada antes da entrada
            em vigor.
          </Flash>
        )}
        {!user ? (
          <p>
            <Link to="/login">Entre na conta</Link> para registrar e acompanhar um pedido.
          </p>
        ) : (
          <>
            {notices.length > 0 && (
              <section aria-labelledby="notices-title">
                <h2 id="notices-title">Decisões sobre sua conta</h2>
                {notices.map((notice) => (
                  <Box
                    as="article"
                    key={notice.id}
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
                    <Heading as="h3" sx={{ fontSize: 1 }}>
                      Protocolo {notice.id}
                    </Heading>
                    <Text as="p" sx={{ m: 0 }}>
                      <strong>Regra:</strong> {notice.rule}
                    </Text>
                    <Text as="p" className="support-message" sx={{ m: 0 }}>
                      {notice.reason}
                    </Text>
                    {notice.communityId && (
                      <Text as="p" sx={{ m: 0, fontSize: 0, color: 'fg.muted' }}>
                        Comunidade: {notice.communityId}
                      </Text>
                    )}
                    {notice.until && (
                      <Text as="p" sx={{ m: 0, fontSize: 0, color: 'fg.muted' }}>
                        Prazo: {formatDateTime(toDate(notice.until))}
                      </Text>
                    )}
                    <Button
                      sx={{ alignSelf: 'flex-start' }}
                      onClick={() => {
                        setKind('appeal')
                        setDecisionId(notice.id)
                        document.getElementById('support-form-title')?.focus()
                      }}
                    >
                      Recorrer desta decisão
                    </Button>
                  </Box>
                ))}
              </section>
            )}
            <form onSubmit={submit} className="support-form">
              <h2 id="support-form-title" tabIndex={-1}>
                Novo pedido
              </h2>
              {error && (
                <Flash variant="danger" role="alert">
                  {error}
                </Flash>
              )}
              {success && (
                <Flash variant="success" role="status">
                  {success}
                </Flash>
              )}
              <FormControl disabled={saving}>
                <FormControl.Label>Assunto</FormControl.Label>
                <Select block value={kind} onChange={(e) => setKind(e.target.value)}>
                  {Object.entries(KINDS).map(([value, label]) => (
                    <Select.Option key={value} value={value}>
                      {label}
                    </Select.Option>
                  ))}
                </Select>
              </FormControl>
              {kind === 'report' && (
                <>
                  {listingId && (
                    <Flash sx={{ mb: 2 }}>
                      Você está denunciando{' '}
                      {listingContext
                        ? `${listingContext.kind === 'professional' ? 'o profissional' : 'o estabelecimento'} "${listingContext.displayName}"`
                        : 'esta vitrine'}
                      .
                    </Flash>
                  )}
                  <FormControl required disabled={saving}>
                    <FormControl.Label>Categoria da denúncia</FormControl.Label>
                    <Select block value={category} onChange={(e) => setCategory(e.target.value)}>
                      <Select.Option value="">Selecione uma categoria</Select.Option>
                      {REPORT_CATEGORY_OPTIONS.map((option) => (
                        <Select.Option key={option.value} value={option.value}>
                          {option.label}
                        </Select.Option>
                      ))}
                    </Select>
                  </FormControl>
                  {!listingId && (
                    <FormControl disabled={saving}>
                      <FormControl.Label>Identificador da publicação (opcional)</FormControl.Label>
                      <TextInput
                        block
                        maxLength={128}
                        value={statusId}
                        onChange={(e) => setStatusId(e.target.value)}
                      />
                      <FormControl.Caption>
                        Use o botão de denúncia na publicação para preencher automaticamente.
                      </FormControl.Caption>
                    </FormControl>
                  )}
                  <FormControl disabled={saving}>
                    <FormControl.Label>Identificador da comunidade (opcional)</FormControl.Label>
                    <TextInput
                      block
                      maxLength={128}
                      value={communityId}
                      onChange={(e) => setCommunityId(e.target.value)}
                    />
                  </FormControl>
                </>
              )}
              {kind === 'appeal' && (
                <FormControl required disabled={saving}>
                  <FormControl.Label>Protocolo da decisão</FormControl.Label>
                  <TextInput
                    block
                    required
                    maxLength={128}
                    value={decisionId}
                    onChange={(e) => setDecisionId(e.target.value)}
                  />
                </FormControl>
              )}
              <FormControl required disabled={saving}>
                <FormControl.Label>Descreva o pedido</FormControl.Label>
                <Textarea
                  block
                  required
                  rows={5}
                  resize="vertical"
                  minLength={10}
                  maxLength={3000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <FormControl.Caption>
                  Inclua os fatos principais. Não envie senhas. {message.length}/3000 caracteres.
                </FormControl.Caption>
              </FormControl>
              <Button type="submit" variant="primary" disabled={saving} loading={saving}>
                Registrar pedido
              </Button>
            </form>
            <section aria-labelledby="requests-title">
              <h2 id="requests-title">Seus pedidos recentes</h2>
              {loading && <Spinner aria-label="Carregando atendimento" />}
              {loadError && (
                <Flash variant="danger" role="alert">
                  {loadError} <Button onClick={refresh}>Tentar novamente</Button>
                </Flash>
              )}
              {!loading && !loadError && requests.length === 0 && <p>Nenhum pedido registrado.</p>}
              {requests.map((item) => (
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
                      <Heading as="h3" sx={{ fontSize: 1 }}>
                        {KINDS[item.kind]}
                      </Heading>
                      <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                        Protocolo {item.id} · {formatDateTime(toDate(item.createdAt))}
                      </Text>
                    </Box>
                    <Label variant={STATE_LABELS[item.state]?.variant}>
                      {STATE_LABELS[item.state]?.text || item.state}
                    </Label>
                  </Box>
                  <Text as="p" className="support-message" sx={{ m: 0 }}>
                    {item.message}
                  </Text>
                  {item.response ? (
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
                        Resposta da administração
                        {item.decidedAt ? ` · ${formatDateTime(toDate(item.decidedAt))}` : ''}
                      </Text>
                      <Text as="p" className="support-message" sx={{ m: 0 }}>
                        {item.response}
                      </Text>
                    </Box>
                  ) : (
                    <Text as="p" sx={{ m: 0, fontSize: 0, color: 'fg.muted' }}>
                      Ainda sem resposta. Você será avisado aqui assim que a administração decidir.
                    </Text>
                  )}
                  {item.state === 'open' && (
                    <Button
                      variant="danger"
                      size="small"
                      sx={{ alignSelf: 'flex-start' }}
                      disabled={cancelingId === item.id}
                      onClick={() => handleCancel(item)}
                    >
                      Cancelar pedido
                    </Button>
                  )}
                </Box>
              ))}
              {hasMore && (
                <Button onClick={loadMore} disabled={loading}>
                  Carregar mais pedidos
                </Button>
              )}
            </section>
          </>
        )}
      </div>
    </PublicLayout>
  )
}
