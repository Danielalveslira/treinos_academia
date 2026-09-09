import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Flash, FormControl, Select, Spinner, Textarea, TextInput } from '@primer/react'
import { PublicLayout } from '../components/PublicLayout'
import { useAuth } from '../hooks/useAuth'
import { useSupport } from '../hooks/useSupport'
import { submitSupportRequest } from '../services/supportService'
import { LEGAL_MANIFEST } from '../utils/legal'
import { formatDateTime } from '../utils/format'

const KINDS = {
  report: 'Denunciar violação',
  appeal: 'Recorrer de uma decisão',
  privacy: 'Privacidade ou exclusão da conta',
  billing: 'Cancelamento ou pagamento',
}

export default function Support() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const [kind, setKind] = useState(
    Object.hasOwn(KINDS, params.get('tipo')) ? params.get('tipo') : 'report'
  )
  const [message, setMessage] = useState('')
  const [statusId, setStatusId] = useState(params.get('publicacao') || '')
  const [communityId, setCommunityId] = useState(params.get('comunidade') || '')
  const [decisionId, setDecisionId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const { requests, notices, loading, error: loadError, refresh } = useSupport(user?.uid)

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    if (message.trim().length < 10) {
      setError('Descreva o pedido usando pelo menos 10 caracteres.')
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
        communityId: kind === 'report' ? communityId : '',
        decisionId: kind === 'appeal' ? decisionId : '',
      })
      setSuccess(`Pedido registrado. Protocolo: ${result.id}.`)
      setMessage('')
      await refresh()
    } catch (err) {
      setError(
        err.code === 'functions/resource-exhausted'
          ? 'Aguarde um minuto antes de enviar outro pedido.'
          : 'Não foi possível registrar o pedido. O texto foi mantido. Tente novamente ou utilize o e-mail de contato.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <PublicLayout>
      <div className="support-page">
        <h1>Atendimento</h1>
        <p>Denúncias, recursos, privacidade e dúvidas sobre pagamentos em um canal privado.</p>
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
                  <article className="support-card" key={notice.id}>
                    <h3>Protocolo {notice.id}</h3>
                    <p>
                      <strong>Regra:</strong> {notice.rule}
                    </p>
                    <p>{notice.reason}</p>
                    {notice.communityId && <p>Comunidade: {notice.communityId}</p>}
                    {notice.until && <p>Prazo: {formatDateTime(notice.until.toDate())}</p>}
                    <Button
                      onClick={() => {
                        setKind('appeal')
                        setDecisionId(notice.id)
                        document.getElementById('support-form-title')?.focus()
                      }}
                    >
                      Recorrer desta decisão
                    </Button>
                  </article>
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
                  rows={8}
                  resize="vertical"
                  minLength={10}
                  maxLength={3000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <FormControl.Caption>
                  Inclua fatos, regra violada e referências úteis. Não envie senhas nem material
                  ilegal envolvendo menores. {message.length}/3000 caracteres.
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
                <article className="support-card" key={item.id}>
                  <h3>
                    {KINDS[item.kind]} · {item.state === 'open' ? 'Em análise' : 'Respondido'}
                  </h3>
                  <p>Protocolo: {item.id}</p>
                  <p className="support-message">{item.message}</p>
                  {item.response && (
                    <p>
                      <strong>Resposta:</strong> {item.response}
                    </p>
                  )}
                </article>
              ))}
              {requests.length === 50 && (
                <p>
                  Exibindo os 50 pedidos mais recentes. Informe o protocolo no atendimento para
                  consultar um pedido anterior.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </PublicLayout>
  )
}
