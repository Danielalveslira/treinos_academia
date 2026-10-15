import { useState } from 'react'
import { Button, Flash, Spinner, TextInput } from '@primer/react'
import { CheckCircleFillIcon, CircleIcon, SearchIcon } from '@primer/octicons-react'
import { useAdminExerciseVisuals } from '../hooks/useAdminExerciseVisuals'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { ExerciseVisualDetail } from '../components/exerciseVisuals/ExerciseVisualDetail'
import { formatCatalogLabel } from '../utils/exerciseCatalog.js'
import AdminNav from '../components/AdminNav'

function formatPercent(value) {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

function Stats({ coverage }) {
  return (
    <p className="ev-stats" data-testid="visual-coverage">
      {coverage &&
        `${coverage.total} exercícios · ${coverage.published} publicados · ${coverage.missing} sem imagem · ${formatPercent(coverage.percent)} de cobertura`}
    </p>
  )
}

function ExerciseRow({ exercise, active, onSelect }) {
  const version = exercise.published_media_refs?.version
  const meta = [exercise.primary_muscle, exercise.equipment]
    .filter(Boolean)
    .map(formatCatalogLabel)
    .join(' · ')
  return (
    <li>
      <button
        type="button"
        className="exercise-visuals-row ev-row"
        aria-pressed={active}
        onClick={() => onSelect(exercise)}
      >
        <span className="ev-row-text">
          <span className="ev-row-name">{exercise.name}</span>
          <span className="ev-muted">{meta}</span>
        </span>
        <span
          className={`ev-row-status${version ? ' is-published' : ''}`}
          title={version ? `Publicada · v${version}` : 'Sem imagem'}
        >
          {version ? (
            <>
              <CheckCircleFillIcon size={14} aria-label="Publicada" />v{version}
            </>
          ) : (
            <CircleIcon size={14} aria-label="Sem imagem" />
          )}
        </span>
      </button>
    </li>
  )
}

// /admin/exercicios-imagens -- só superadmin (SuperAdminRoute) e só online: enviar, aprovar e publicar
// exigem servidor, então tudo é travado sem conexão. O aluno nunca passa por aqui: ele lê
// exercise_catalog.published_media_refs já publicado. Ver
// docs/promps/Evolutus_arquitetura_imagens_exercicios_V2_auditada.md.
export default function AdminExerciseVisuals() {
  const online = useOnlineStatus()
  const visuals = useAdminExerciseVisuals()
  const [searchDraft, setSearchDraft] = useState('')
  const { list, page, pageSize, selected } = visuals
  const lastPage = Math.max(Math.ceil(list.total / pageSize) - 1, 0)

  return (
    <div className="ev-page">
      <AdminNav current="/admin/exercicios-imagens" currentLabel="Imagens dos exercícios" />
      <header className="ev-header">
        <h1>Imagens dos exercícios</h1>
        <p>Gerencie, revise e publique as imagens oficiais do catálogo.</p>
      </header>

      {!online && (
        <Flash variant="warning" role="status">
          Sem conexão. Enviar, aprovar e publicar imagens exige internet.
        </Flash>
      )}

      <div className="ev-toolbar">
        <form
          className="ev-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            visuals.search(searchDraft)
          }}
        >
          <TextInput
            block
            leadingVisual={SearchIcon}
            type="search"
            aria-label="Buscar exercício"
            placeholder="Buscar exercício…"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          <Button type="submit">Buscar</Button>
        </form>
        <label className="ev-check">
          <input
            type="checkbox"
            checked={visuals.filters.onlyMissing}
            onChange={(event) => visuals.toggleOnlyMissing(event.target.checked)}
          />
          <span>Somente sem imagem</span>
        </label>
        <Stats coverage={visuals.coverage} />
      </div>

      <div className="exercise-visuals-layout">
        <section className="ev-list" aria-label="Exercícios">
          <h2 className="ev-eyebrow">Exercícios</h2>
          {visuals.listError && <Flash variant="danger">{visuals.listError.message}</Flash>}
          <div className="ev-list-scroll">
            {visuals.listLoading ? (
              <div className="ev-loading">
                <Spinner />
              </div>
            ) : list.data.length === 0 ? (
              <p className="ev-muted">Nenhum exercício encontrado.</p>
            ) : (
              <ul>
                {list.data.map((exercise) => (
                  <ExerciseRow
                    key={exercise.id}
                    exercise={exercise}
                    active={selected?.id === exercise.id}
                    onSelect={visuals.select}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="ev-pager">
            <Button
              size="small"
              disabled={page === 0 || visuals.listLoading}
              onClick={() => visuals.setPage(page - 1)}
            >
              Anterior
            </Button>
            <span className="ev-muted">
              Página {page + 1} de {lastPage + 1} · {list.total} exercícios
            </span>
            <Button
              size="small"
              disabled={page >= lastPage || visuals.listLoading}
              onClick={() => visuals.setPage(page + 1)}
            >
              Próxima
            </Button>
          </div>
        </section>

        {selected ? (
          <ExerciseVisualDetail key={selected.id} visuals={visuals} online={online} />
        ) : (
          <section className="ev-detail ev-detail-empty" aria-label="Detalhe do exercício">
            <h2 className="ev-eyebrow">Exercício selecionado</h2>
            <p className="ev-muted">Selecione um exercício na lista para gerenciar as imagens.</p>
          </section>
        )}
      </div>
    </div>
  )
}
