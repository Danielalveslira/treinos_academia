import { useState } from 'react'
import { Button, Text } from '@primer/react'
import { reportComment } from '../api/comments.api'

export function CommentReportForm({ commentId, onClose }) {
  const [reason, setReason] = useState('Conteúdo impróprio')
  const [details, setDetails] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      await reportComment(commentId, reason, details.trim() || null)
      onClose(true)
    } catch {
      setError('Não foi possível enviar a denúncia.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="comment-report-form" onSubmit={submit}>
      <label>
        Motivo
        <select value={reason} onChange={(event) => setReason(event.target.value)}>
          <option>Conteúdo impróprio</option>
          <option>Assédio ou ameaça</option>
          <option>Spam</option>
          <option>Informação pessoal</option>
        </select>
      </label>
      <label>
        Detalhes opcionais
        <textarea
          rows="2"
          maxLength="3000"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
        />
      </label>
      <div className="comment-report-actions">
        <Button type="button" size="small" variant="invisible" onClick={() => onClose(false)}>
          Cancelar
        </Button>
        <Button type="submit" size="small" variant="danger" disabled={pending}>
          {pending ? 'Enviando…' : 'Enviar denúncia'}
        </Button>
      </div>
      {error && (
        <Text className="comment-error" role="alert">
          {error}
        </Text>
      )}
    </form>
  )
}
