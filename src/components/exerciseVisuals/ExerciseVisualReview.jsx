import { useState } from 'react'
import { Button } from '@primer/react'
import { ExerciseVisualPreview } from './ExerciseVisualPreview'

const REVIEW_CHECKLIST = [
  'Exercício correto',
  'Equipamento correto',
  'Posição inicial correta',
  'Posição final correta',
  'Anatomia aceitável',
  'Sem membros extras',
  'Sem texto estranho',
  'Sem logotipo de terceiros',
  'Fundo correto',
  'Mesmo padrão visual do Evolutus',
]

function ReviewCard({ set, exerciseName, busy, disabled, onApprove, onReject }) {
  const [checked, setChecked] = useState({})
  const [reason, setReason] = useState('')
  const hasThumbnail = (set.assets || []).some((asset) => asset.role === 'thumbnail')
  const allChecked = REVIEW_CHECKLIST.every((item) => checked[item])
  const working = busy === `publish:${set.id}` || busy === `reject:${set.id}`

  return (
    <div className="ev-review-card">
      <strong>Versão {set.version} em revisão</strong>
      <ExerciseVisualPreview
        urls={set.previewUrls}
        roles={hasThumbnail ? ['start', 'end', 'thumbnail'] : ['start', 'end']}
        name={exerciseName}
        size="sm"
      />
      {!hasThumbnail && (
        <span className="ev-muted">
          Sem miniatura: início e final podem ser publicados normalmente.
        </span>
      )}
      <fieldset className="ev-checklist">
        <legend>Checklist de revisão</legend>
        {REVIEW_CHECKLIST.map((item) => (
          <label key={item}>
            <input
              type="checkbox"
              checked={Boolean(checked[item])}
              disabled={disabled || working}
              onChange={(event) =>
                setChecked((current) => ({ ...current, [item]: event.target.checked }))
              }
            />
            <span>{item}</span>
          </label>
        ))}
      </fieldset>
      <div className="ev-actions">
        <Button
          variant="primary"
          disabled={disabled || Boolean(busy) || !allChecked}
          onClick={() => onApprove(set.id)}
        >
          {busy === `publish:${set.id}` ? 'Publicando…' : 'Aprovar e publicar'}
        </Button>
        <input
          type="text"
          className="ev-input"
          aria-label="Motivo da rejeição"
          placeholder="Motivo da rejeição (opcional)"
          maxLength={500}
          value={reason}
          disabled={disabled || working}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button
          variant="danger"
          disabled={disabled || Boolean(busy)}
          onClick={() => onReject(set.id, reason)}
        >
          {busy === `reject:${set.id}` ? 'Rejeitando…' : 'Rejeitar'}
        </Button>
      </div>
    </div>
  )
}

// Sem nada em revisão a seção inteira some (nenhum bloco vazio ocupando espaço).
export function ExerciseVisualReview({ sets, exerciseName, busy, disabled, onApprove, onReject }) {
  const inReview = sets.filter((set) => set.status === 'review')
  if (!inReview.length) return null
  return (
    <section className="ev-section" aria-label="Revisão">
      <h3>Aguardando revisão</h3>
      {inReview.map((set) => (
        <ReviewCard
          key={set.id}
          set={set}
          exerciseName={exerciseName}
          busy={busy}
          disabled={disabled}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
    </section>
  )
}
