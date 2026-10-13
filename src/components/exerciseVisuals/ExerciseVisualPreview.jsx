import { useState } from 'react'
import { Dialog } from '@primer/react'
import { ExerciseCatalogImage } from '../ExerciseCatalogImage'

const ROLE_LABELS = { start: 'Início', end: 'Final', thumbnail: 'Miniatura' }
export function ExerciseVisualPreview({
  urls = {},
  roles = ['start', 'end'],
  name = '',
  size = 'md',
  onLoad,
  onError,
}) {
  const [zoom, setZoom] = useState(null)
  return (
    <>
      <div className="ev-preview" data-size={size} data-testid="visual-preview">
        {roles.map((role) => (
          <figure key={role} className="ev-figure">
            <button
              className="ev-image-zoom"
              type="button"
              disabled={!urls[role]}
              onClick={() => setZoom(role)}
              aria-label={`Ampliar ${ROLE_LABELS[role]}${name ? ` — ${name}` : ''}`}
            >
              <ExerciseCatalogImage
                key={urls[role] || role}
                src={urls[role]}
                alt={`${ROLE_LABELS[role]}${name ? ` — ${name}` : ''}`}
                className="exercise-visual-preview-image"
                fallbackLabel="Arquivo indisponível"
                loading={size === 'review' ? 'eager' : 'lazy'}
                onLoad={(event) => onLoad?.(role, event.currentTarget)}
                onError={() => onError?.(role)}
              />
            </button>
            <figcaption>{ROLE_LABELS[role]}</figcaption>
          </figure>
        ))}
      </div>
      {zoom && (
        <Dialog
          title={`${ROLE_LABELS[zoom]} — ${name}`}
          onClose={() => setZoom(null)}
          width="xlarge"
        >
          <img className="ev-zoom-image" src={urls[zoom]} alt={`${ROLE_LABELS[zoom]} — ${name}`} />
        </Dialog>
      )}
    </>
  )
}
