import { Button, Label } from '@primer/react'
import { formatDateTime } from '../../utils/format'
import { PROMPT_PROVIDER_FORMATS } from '../../utils/exerciseVisualPromptBuilder'
import { ExerciseVisualPreview } from './ExerciseVisualPreview'

const STATUS_LABELS = {
  allocated: { text: 'Aguardando upload', variant: 'secondary' },
  draft: { text: 'Rascunho', variant: 'secondary' },
  review: { text: 'Em revisão', variant: 'attention' },
  published: { text: 'Publicada', variant: 'success' },
  rejected: { text: 'Rejeitada', variant: 'danger' },
  archived: { text: 'Arquivada', variant: 'secondary' },
  failed: { text: 'Falhou', variant: 'danger' },
}

const SOURCE_LABELS = {
  manual_upload: 'Upload manual',
  gemini_manual: 'IA (manual)',
  gemini_api: 'IA (API)',
}

function provenanceText(set) {
  const parts = []
  if (set.style_version) parts.push(`estilo ${set.style_version}`)
  if (set.prompt_version) parts.push(`prompt ${set.prompt_version}`)
  if (set.provider_hint)
    parts.push(`formato ${PROMPT_PROVIDER_FORMATS[set.provider_hint]?.label || set.provider_hint}`)
  if (set.reference_style_version) parts.push(`referência ${set.reference_style_version}`)
  return parts.join(' · ')
}

export function ExerciseVisualHistory({ sets, exerciseName, busy, disabled, onRestore }) {
  return (
    <details className="ev-history">
      <summary>Histórico ({sets.length})</summary>
      {!sets.length ? (
        <p className="ev-muted">Nenhuma versão enviada ainda.</p>
      ) : (
        <ul>
          {sets.map((set) => {
            const status = STATUS_LABELS[set.status] || { text: set.status, variant: 'secondary' }
            return (
              <li key={set.id}>
                <div className="ev-history-head">
                  <strong>Versão {set.version}</strong>
                  <Label variant={status.variant}>{status.text}</Label>
                  <span className="ev-muted">
                    {SOURCE_LABELS[set.generation_source] || set.generation_source}
                    {set.created_at ? ` · criada em ${formatDateTime(set.created_at)}` : ''}
                    {set.published_at ? ` · publicada em ${formatDateTime(set.published_at)}` : ''}
                  </span>
                </div>
                {provenanceText(set) && <span className="ev-muted">{provenanceText(set)}</span>}
                {set.status === 'failed' && set.metadata?.failure?.reason && (
                  <span className="ev-muted">Falha: {set.metadata.failure.reason}</span>
                )}
                {set.status === 'rejected' && set.metadata?.rejection?.reason && (
                  <span className="ev-muted">Motivo: {set.metadata.rejection.reason}</span>
                )}
                {set.status === 'archived' && (
                  <>
                    <ExerciseVisualPreview urls={set.previewUrls} name={exerciseName} size="sm" />
                    <div className="ev-actions">
                      <Button
                        size="small"
                        disabled={disabled || Boolean(busy)}
                        onClick={() => onRestore(set.id)}
                      >
                        {busy === `restore:${set.id}`
                          ? 'Restaurando…'
                          : 'Restaurar esta versão (rollback)'}
                      </Button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}
