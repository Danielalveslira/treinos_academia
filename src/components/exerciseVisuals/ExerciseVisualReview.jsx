import { useState } from 'react'
import { Button, Flash } from '@primer/react'
import { REJECTION_REASONS, visualFileIssues } from '../../utils/exerciseVisualReview'
import { ExerciseVisualPreview } from './ExerciseVisualPreview'
import { ExerciseVisualDeleteButton } from './ExerciseVisualDeleteButton'
const WARNING_LABELS = {
  START_END_IDENTICAL_FILE: 'Início e final são o mesmo arquivo. Confira as poses.',
  START_END_NEARLY_IDENTICAL: 'Início e final são muito parecidos. Confira se o movimento muda.',
  DUPLICATE_FILE_IN_OTHER_SET:
    'Arquivo usado em outra versão; confira se corresponde ao exercício.',
}
function ReviewCard({ set, exerciseName, busy, disabled, onApprove, onReject, onDelete }) {
  const [inspected, setInspected] = useState(false)
  const [reason, setReason] = useState('Posição incorreta')
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [loaded, setLoaded] = useState({})
  const hasThumbnail = set.assets?.some((asset) => asset.role === 'thumbnail')
  const roles = hasThumbnail ? ['start', 'end', 'thumbnail'] : ['start', 'end']
  const issues = [
    ...visualFileIssues(set),
    ...roles
      .filter((role) => loaded[role] === false)
      .map((role) => `Não foi possível abrir ${role.toUpperCase()}.`),
  ]
  const ready = issues.length === 0 && roles.every((role) => loaded[role] === true)
  return (
    <div className="ev-review-card">
      <strong>Versão {set.version} em revisão</strong>
      {issues.map((issue) => (
        <Flash key={issue} variant="danger" role="alert">
          {issue}
        </Flash>
      ))}
      {(set.metadata?.validation?.warnings || []).map((warning) => (
        <Flash key={warning} variant="warning" role="status">
          {WARNING_LABELS[warning] || warning}
        </Flash>
      ))}
      <ExerciseVisualPreview
        urls={set.previewUrls}
        roles={roles}
        name={exerciseName}
        size="review"
        onLoad={(role, image) => {
          const asset = set.assets.find((a) => a.role === role)
          const valid = image.naturalWidth === asset?.width && image.naturalHeight === asset?.height
          setLoaded((current) =>
            current[role] === valid ? current : { ...current, [role]: valid }
          )
        }}
        onError={(role) => setLoaded((current) => ({ ...current, [role]: false }))}
      />
      {!hasThumbnail && (
        <span className="ev-muted">
          Sem miniatura: início e final podem ser publicados normalmente.
        </span>
      )}
      <p className="ev-muted">
        Arquivo e dimensões são verificados automaticamente. Exercício, biomecânica, avatar,
        equipamento e compatibilidade da miniatura exigem inspeção humana. Clique nas imagens para
        ampliar.
      </p>
      <label className="ev-inspection">
        <input
          type="checkbox"
          checked={inspected}
          disabled={disabled || Boolean(busy)}
          onChange={(event) => setInspected(event.target.checked)}
        />
        <span>
          Inspecionei as duas poses, o avatar e o equipamento
          {hasThumbnail ? ', incluindo a miniatura' : ''}; estão corretos para este exercício.
        </span>
      </label>
      <div className="ev-actions">
        <Button
          variant="primary"
          disabled={disabled || Boolean(busy) || !inspected || !ready}
          onClick={() => onApprove(set.id)}
        >
          {busy === `publish:${set.id}` ? 'Publicando…' : 'Aprovar e publicar'}
        </Button>
        <Button
          disabled={disabled || Boolean(busy)}
          onClick={() => setRejecting((value) => !value)}
        >
          Rejeitar
        </Button>
        <ExerciseVisualDeleteButton set={set} busy={busy} disabled={disabled} onDelete={onDelete} />
      </div>
      {rejecting && (
        <div className="ev-rejection">
          <label className="ev-file">
            <span>Motivo da rejeição</span>
            <select
              className="ev-input"
              aria-label="Motivo da rejeição"
              value={reason}
              disabled={disabled || Boolean(busy)}
              onChange={(event) => setReason(event.target.value)}
            >
              {REJECTION_REASONS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="ev-file">
            <span>Observação (opcional)</span>
            <input
              className="ev-input"
              maxLength={350}
              value={note}
              disabled={disabled || Boolean(busy)}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <span className="ev-muted">Rejeitar mantém a versão e o histórico.</span>
          <Button
            variant="danger"
            disabled={disabled || Boolean(busy)}
            onClick={() => onReject(set.id, `${reason}${note.trim() ? ` — ${note.trim()}` : ''}`)}
          >
            {busy === `reject:${set.id}` ? 'Rejeitando…' : 'Confirmar rejeição'}
          </Button>
        </div>
      )}
    </div>
  )
}
export function ExerciseVisualReview({ sets, ...props }) {
  const inReview = sets.filter((set) => set.status === 'review')
  if (!inReview.length) return null
  return (
    <section className="ev-section" aria-label="Revisão">
      <h3>Aguardando revisão</h3>
      {inReview.map((set) => (
        <ReviewCard key={set.id} set={set} {...props} />
      ))}
    </section>
  )
}
