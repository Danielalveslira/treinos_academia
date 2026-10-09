import { useEffect, useRef, useState } from 'react'
import { Button, Flash, Label, Spinner } from '@primer/react'
import { UploadIcon } from '@primer/octicons-react'
import { CopyButton } from '../CopyButton'
import { formatCatalogLabel } from '../../utils/exerciseCatalog.js'
import { ExerciseVisualHistory } from './ExerciseVisualHistory'
import { ExerciseVisualPreview } from './ExerciseVisualPreview'
import { ExerciseVisualReview } from './ExerciseVisualReview'
import { ExerciseVisualUploadForm } from './ExerciseVisualUploadForm'

function currentStatus(sets) {
  const published = sets.find((set) => set.status === 'published')
  if (published) return { text: `Publicada · v${published.version}`, variant: 'success', published }
  if (sets.some((set) => set.status === 'review')) {
    return { text: 'Em revisão', variant: 'attention', published: null }
  }
  return { text: 'Sem imagem', variant: 'secondary', published: null }
}

// Painel do exercício selecionado: imagem atual, ações para criar uma nova (prompt para qualquer IA ou
// upload), revisão (só quando há algo em revisão) e histórico recolhido. A origem da imagem é neutra:
// o fluxo de revisão/publicação é o mesmo para IA, prompt externo ou upload manual.
export function ExerciseVisualDetail({ visuals, online }) {
  const { selected, sets, prompt, busy } = visuals
  const [uploadOpen, setUploadOpen] = useState(false)
  const root = useRef(null)
  const status = currentStatus(sets)

  // Em telas estreitas a lista fica acima do painel: ao escolher um exercício, leva o painel à vista.
  useEffect(() => {
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 959px)').matches
    ) {
      root.current?.scrollIntoView?.({ block: 'start' })
    }
  }, [])

  async function submitUpload(files) {
    const ok = await visuals.upload(files)
    if (ok) setUploadOpen(false)
    return ok
  }

  const subtitle = [selected.primary_muscle, selected.equipment]
    .filter(Boolean)
    .map(formatCatalogLabel)
    .join(' · ')

  return (
    <section className="ev-detail" aria-label="Detalhe do exercício" ref={root}>
      <header className="ev-detail-head">
        <div>
          <h2>{selected.name}</h2>
          {subtitle && <span className="ev-muted">{subtitle}</span>}
        </div>
        <Label variant={status.variant}>{status.text}</Label>
      </header>

      {visuals.actionError && (
        <Flash variant="danger" role="alert">
          {visuals.actionError}
        </Flash>
      )}
      {visuals.setsError && <Flash variant="danger">{visuals.setsError.message}</Flash>}

      {visuals.setsLoading ? (
        <div className="ev-loading">
          <Spinner size="small" />
        </div>
      ) : (
        <ExerciseVisualPreview urls={status.published?.previewUrls} name={selected.name} />
      )}

      <section className="ev-section" aria-label="Novo conjunto">
        <h3>Criar com IA</h3>
        <p className="ev-muted">
          Copie o prompt, gere as imagens na ferramenta de IA que preferir (ou use arte própria) e
          envie o resultado.
        </p>
        <div className="ev-actions">
          {prompt && (
            <CopyButton value={prompt.text} label="Copiar prompt" testId="copy-visual-prompt" />
          )}
          <Button
            size="small"
            leadingVisual={UploadIcon}
            aria-expanded={uploadOpen}
            disabled={!online}
            onClick={() => setUploadOpen((open) => !open)}
          >
            Enviar imagens
          </Button>
        </div>
        {prompt && (
          <details className="ev-prompt">
            <summary>Ver prompt</summary>
            <pre>{prompt.text}</pre>
          </details>
        )}
        {uploadOpen && (
          <ExerciseVisualUploadForm
            busy={busy}
            disabled={!online}
            onSubmit={submitUpload}
            onCancel={() => setUploadOpen(false)}
          />
        )}
      </section>

      {!visuals.setsLoading && (
        <>
          <ExerciseVisualReview
            sets={sets}
            exerciseName={selected.name}
            busy={busy}
            disabled={!online}
            onApprove={visuals.approve}
            onReject={visuals.reject}
          />
          <ExerciseVisualHistory
            sets={sets}
            exerciseName={selected.name}
            busy={busy}
            disabled={!online}
            onRestore={visuals.restore}
          />
        </>
      )}
    </section>
  )
}
