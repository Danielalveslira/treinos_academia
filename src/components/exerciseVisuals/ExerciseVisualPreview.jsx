import { ExerciseCatalogImage } from '../ExerciseCatalogImage'

const ROLE_LABELS = { start: 'Início', end: 'Final', thumbnail: 'Miniatura' }

// Mostra os arquivos de um conjunto visual lado a lado. Reaproveita ExerciseCatalogImage: arquivo
// ausente ou que falhou ao carregar cai no mesmo placeholder do resto do app.
export function ExerciseVisualPreview({
  urls = {},
  roles = ['start', 'end'],
  name = '',
  size = 'md',
}) {
  return (
    <div className="ev-preview" data-size={size} data-testid="visual-preview">
      {roles.map((role) => (
        <figure key={role} className="ev-figure">
          <ExerciseCatalogImage
            src={urls[role]}
            alt={`${ROLE_LABELS[role]}${name ? ` — ${name}` : ''}`}
            className="exercise-visual-preview-image"
            fallbackLabel="Sem imagem"
          />
          <figcaption>{ROLE_LABELS[role]}</figcaption>
        </figure>
      ))}
    </div>
  )
}
