import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Button, Flash, FormControl, Select, Spinner, Textarea, TextInput } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useSupport } from '../hooks/useSupport'
import { decideSupportRequest } from '../services/supportService'

const ACTIONS = {
  no_action: 'Responder sem penalidade',
  warning: 'Advertência',
  remove_content: 'Remover publicação',
  temporary_suspension: 'Suspensão temporária do sistema',
  community_ban: 'Banimento da comunidade',
  system_ban: 'Banimento do sistema',
  restore: 'Revogar restrição',
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
    } catch {
      setError('Não foi possível registrar a decisão. Confira os dados e tente novamente.')
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
        <FormControl>
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
        <Flash variant="danger">
          {loadError} <Button onClick={refresh}>Tentar novamente</Button>
        </Flash>
      )}
      {!selected &&
        requests.map((item) => (
          <article className="support-card" key={item.id}>
            <h2>Pedido {item.id}</h2>
            <Link to={`/admin/contas?usuario=${encodeURIComponent(item.userId)}`}>
              Ver conta do solicitante
            </Link>
            <p>
              Tipo: {item.kind} · {item.state === 'open' ? 'Em análise' : 'Respondido'}
            </p>
            <p className="support-message">{item.message}</p>
            {item.response && <p>Decisão: {item.response}</p>}
            {item.state === 'open' && <Button onClick={() => select(item)}>Analisar pedido</Button>}
          </article>
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
