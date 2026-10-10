import { useEffect, useRef, useState } from 'react'
import { Button, Flash, Label, Spinner } from '@primer/react'
import { UploadIcon } from '@primer/octicons-react'
import { CopyButton } from '../CopyButton'
import { formatCatalogLabel } from '../../utils/exerciseCatalog.js'
import {
  PROMPT_PROVIDER_FORMATS,
  PROMPT_PROVIDER_OPTIONS,
  STYLE_PROFILE_ERROR_MESSAGE,
} from '../../utils/exerciseVisualPromptBuilder'
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
  const { selected, sets, prompts, promptProvider, busy, styleProfileState } = visuals
  const [uploadOpen, setUploadOpen] = useState(false)
  const [startReady, setStartReady] = useState(false)
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
    if (ok) {
      setUploadOpen(false)
      setStartReady(false)
    }
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
          Uma imagem por vez: copie o prompt INICIAL e gere a posição inicial; depois copie o prompt
          FINAL e gere a posição final usando a imagem inicial como referência. Use a ferramenta de
          IA que preferir (ou arte própria) e envie o resultado.
        </p>
        {!prompts && styleProfileState === 'error' && (
          <Flash variant="danger" role="alert" data-testid="style-profile-error">
            <span>{STYLE_PROFILE_ERROR_MESSAGE}</span>{' '}
            <Button size="small" onClick={visuals.reloadStyleProfile}>
              Tentar novamente
            </Button>
          </Flash>
        )}
        {!prompts && styleProfileState === 'loading' && (
          <span className="ev-muted" role="status">
            Carregando o padrão visual…
          </span>
        )}
        {prompts && (
          <label className="ev-file ev-provider">
            <span>Formato do prompt</span>
            <select
              className="ev-input"
              value={promptProvider}
              onChange={(event) => visuals.setPromptProvider(event.target.value)}
            >
              {PROMPT_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="ev-actions">
          {prompts ? (
            <>
              <CopyButton
                value={prompts.start.text}
                label="Copiar prompt INICIAL"
                testId="copy-visual-prompt-start"
              />
              <CopyButton
                value={prompts.end.text}
                label="Copiar prompt FINAL"
                testId="copy-visual-prompt-end"
              />
            </>
          ) : (
            <>
              <Button size="small" disabled data-testid="copy-visual-prompt-start">
                Copiar prompt INICIAL
              </Button>
              <Button size="small" disabled data-testid="copy-visual-prompt-end">
                Copiar prompt FINAL
              </Button>
            </>
          )}
          <Button
            size="small"
            leadingVisual={UploadIcon}
            aria-expanded={uploadOpen}
            disabled={!online || !prompts}
            onClick={() => setUploadOpen((open) => !open)}
          >
            Enviar imagens
          </Button>
        </div>
        {prompts && startReady && (
          <Flash variant="warning" data-testid="reference-hint">
            Use a imagem inicial como referência ao gerar a posição final.
          </Flash>
        )}
        {prompts && !startReady && (
          <span className="ev-muted" data-testid="reference-hint">
            {PROMPT_PROVIDER_FORMATS[promptProvider]?.attachHint}
          </span>
        )}
        {prompts && (
          <>
            <details className="ev-prompt">
              <summary>Ver prompt inicial</summary>
              <pre>{prompts.start.text}</pre>
            </details>
            <details className="ev-prompt">
              <summary>Ver prompt final</summary>
              <pre>{prompts.end.text}</pre>
            </details>
          </>
        )}
        {uploadOpen && prompts && (
          <ExerciseVisualUploadForm
            busy={busy}
            disabled={!online}
            onSubmit={submitUpload}
            onCancel={() => setUploadOpen(false)}
            onStartFileChange={(file) => setStartReady(Boolean(file))}
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
