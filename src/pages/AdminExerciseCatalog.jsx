import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  FormControl,
  Flash,
  IconButton,
  Select,
  Spinner,
  Text,
  TextInput,
  Textarea,
} from '@primer/react'
import { CheckCircleFillIcon, PlusIcon, SearchIcon, TrashIcon } from '@primer/octicons-react'
import { useAdminExerciseCatalog } from '../hooks/useAdminExerciseCatalog'
import { useAdminExerciseVisuals } from '../hooks/useAdminExerciseVisuals'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { ExerciseVisualDetail } from '../components/exerciseVisuals/ExerciseVisualDetail'
import { formatCatalogLabel } from '../utils/exerciseCatalog.js'
import AdminNav from '../components/AdminNav'

function formatPercent(value) {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

// Indicadores de cobertura de imagem -- os mesmos que existiam em /admin/exercicios-imagens,
// migrados para cá. Reaproveita visuals.coverage (useAdminExerciseVisuals, já composto nesta
// página) e exerciseVisualsService.getVisualCoverage() sem alteração: a consulta já usa
// count('exact', head: true) contra a tabela inteira, nunca o tamanho da página carregada.
function CoverageStats({ coverage }) {
  if (!coverage) return null
  const stats = [
    { label: 'Exercícios cadastrados', value: coverage.total },
    { label: 'Com imagens completas', value: coverage.published },
    { label: 'Pendentes ou incompletas', value: coverage.missing },
    { label: 'Cobertura', value: formatPercent(coverage.percent) },
  ]
  return (
    <Box
      data-testid="visual-coverage"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        marginBottom: 3,
        paddingBottom: 3,
        borderBottom: '1px solid',
        borderColor: 'border.default',
      }}
    >
      {stats.map((stat) => (
        <Box key={stat.label} sx={{ minWidth: '140px' }}>
          <Text as="p" sx={{ margin: 0, fontSize: 0, color: 'fg.muted' }}>
            {stat.label}
          </Text>
          <Text as="p" sx={{ margin: 0, fontSize: 3, fontWeight: 'bold' }}>
            {stat.value}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

const SECTIONS = [
  { key: 'published', label: 'Exercícios' },
  { key: 'draft', label: 'Novo exercício' },
  { key: 'in_review', label: 'Em revisão' },
  { key: 'withdrawn', label: 'Retirados' },
]

// Lista dinâmica de textos (músculos secundários, instruções, orientações de segurança): cada
// linha é um TextInput com remover; "Adicionar" acrescenta uma linha vazia. Reaproveita Primer
// puro (TextInput/IconButton/Button), sem componente novo de biblioteca.
function DynamicList({ label, values, onChange, placeholder, addLabel, multiline = false }) {
  function setAt(index, value) {
    const next = [...values]
    next[index] = value
    onChange(next)
  }
  function removeAt(index) {
    onChange(values.filter((_, i) => i !== index))
  }
  const Field = multiline ? Textarea : TextInput
  return (
    <FormControl>
      <FormControl.Label>{label}</FormControl.Label>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {values.map((value, index) => (
          <Box key={index} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <Field
              block
              value={value}
              placeholder={placeholder}
              onChange={(event) => setAt(index, event.target.value)}
              aria-label={`${label} ${index + 1}`}
            />
            <IconButton
              icon={TrashIcon}
              variant="danger"
              aria-label={`Remover ${label.toLowerCase()} ${index + 1}`}
              onClick={() => removeAt(index)}
            />
          </Box>
        ))}
        <Button size="small" leadingVisual={PlusIcon} onClick={() => onChange([...values, ''])}>
          {addLabel}
        </Button>
      </Box>
    </FormControl>
  )
}

function ExerciseRow({ exercise, active, onSelect }) {
  const meta = [exercise.primary_muscle, exercise.equipment].filter(Boolean).map(formatCatalogLabel).join(' · ')
  // published_media_refs só ganha a chave "version" quando apply_published_visual_set confirma
  // AMBOS os assets start/end completos (ver migration) -- mesmo sinal que a tela antiga usava,
  // já vem na própria listagem, sem consulta extra por linha.
  const hasCompleteImages = Boolean(exercise.published_media_refs?.version)
  return (
    <li>
      <button type="button" className="ev-row" aria-pressed={active} onClick={() => onSelect(exercise)}>
        <span className="ev-row-text">
          <span className="ev-row-name">
            {exercise.name}
            {hasCompleteImages && (
              <CheckCircleFillIcon
                size={14}
                fill="success.fg"
                aria-label="Imagens de início e fim completas"
                data-testid={`has-images-${exercise.id}`}
                style={{ marginLeft: 6, verticalAlign: 'middle' }}
              />
            )}
          </span>
          <span className="ev-muted">{meta}</span>
        </span>
      </button>
    </li>
  )
}

function ContentForm({ catalog }) {
  const { formState, updateFormField } = catalog
  const disabled = catalog.busy === 'save'
  return (
    <Box as="form" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} onSubmit={(e) => e.preventDefault()}>
      <FormControl required disabled={disabled}>
        <FormControl.Label>Nome</FormControl.Label>
        <TextInput block value={formState.name} onChange={(e) => updateFormField('name', e.target.value)} />
      </FormControl>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <FormControl disabled={disabled}>
          <FormControl.Label>Músculo primário</FormControl.Label>
          <TextInput value={formState.primaryMuscle} onChange={(e) => updateFormField('primaryMuscle', e.target.value)} />
        </FormControl>
        <FormControl disabled={disabled}>
          <FormControl.Label>Equipamento</FormControl.Label>
          <TextInput value={formState.equipment} onChange={(e) => updateFormField('equipment', e.target.value)} />
        </FormControl>
        <FormControl disabled={disabled}>
          <FormControl.Label>Categoria</FormControl.Label>
          <TextInput value={formState.category} onChange={(e) => updateFormField('category', e.target.value)} />
        </FormControl>
      </Box>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <FormControl disabled={disabled}>
          <FormControl.Label>Dificuldade</FormControl.Label>
          <Select value={formState.difficulty} onChange={(e) => updateFormField('difficulty', e.target.value)}>
            <Select.Option value="">—</Select.Option>
            <Select.Option value="iniciante">Iniciante</Select.Option>
            <Select.Option value="intermediario">Intermediário</Select.Option>
            <Select.Option value="avancado">Avançado</Select.Option>
          </Select>
        </FormControl>
        <FormControl disabled={disabled}>
          <FormControl.Label>Força</FormControl.Label>
          <Select value={formState.force} onChange={(e) => updateFormField('force', e.target.value)}>
            <Select.Option value="">—</Select.Option>
            <Select.Option value="empurrar">Empurrar</Select.Option>
            <Select.Option value="puxar">Puxar</Select.Option>
            <Select.Option value="estatico">Estático</Select.Option>
          </Select>
        </FormControl>
        <FormControl disabled={disabled}>
          <FormControl.Label>Mecânica</FormControl.Label>
          <Select value={formState.mechanic} onChange={(e) => updateFormField('mechanic', e.target.value)}>
            <Select.Option value="">—</Select.Option>
            <Select.Option value="composto">Composto</Select.Option>
            <Select.Option value="isolado">Isolado</Select.Option>
          </Select>
        </FormControl>
      </Box>
      <DynamicList
        label="Músculos (inclua o primário)"
        values={formState.muscles}
        onChange={(v) => updateFormField('muscles', v)}
        placeholder="ex.: peito"
        addLabel="Adicionar músculo"
      />
      <DynamicList
        label="Instruções (passo a passo)"
        values={formState.instructions}
        onChange={(v) => updateFormField('instructions', v)}
        placeholder="ex.: Desça a barra até o peito."
        addLabel="Adicionar etapa"
        multiline
      />
      <DynamicList
        label="Orientações de segurança (opcional)"
        values={formState.safetyNotes}
        onChange={(v) => updateFormField('safetyNotes', v)}
        placeholder="ex.: Mantenha a coluna neutra."
        addLabel="Adicionar orientação"
        multiline
      />
    </Box>
  )
}

function LifecycleActions({ catalog }) {
  const { selected, busy, isDirty, withdrawReason, setWithdrawReason } = catalog
  const status = selected?.status
  return (
    <Box className="ev-actions" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button
          disabled={!!busy || !isDirty}
          onClick={catalog.saveContent}
          title={!isDirty ? 'Nenhuma alteração para salvar' : undefined}
        >
          {busy === 'save' ? <Spinner size="small" /> : selected ? 'Salvar' : 'Criar rascunho'}
        </Button>
        {selected && status === 'draft' && (
          <Button disabled={!!busy} onClick={catalog.submitForReview}>
            Enviar para revisão
          </Button>
        )}
        {selected && (status === 'draft' || status === 'in_review') && (
          <Button variant="primary" disabled={!!busy} onClick={catalog.publish}>
            Publicar
          </Button>
        )}
        {selected && status === 'withdrawn' && (
          <Button disabled={!!busy} onClick={catalog.restore}>
            Restaurar (volta para revisão)
          </Button>
        )}
      </Box>
      {selected && status === 'published' && (
        <FormControl>
          <FormControl.Label>Motivo da retirada</FormControl.Label>
          <Textarea
            value={withdrawReason}
            onChange={(e) => setWithdrawReason(e.target.value)}
            placeholder="Obrigatório para retirar o exercício do catálogo."
          />
          <Button
            variant="danger"
            disabled={!!busy || withdrawReason.trim() === ''}
            onClick={catalog.withdraw}
            sx={{ marginTop: 2 }}
          >
            Confirmar retirada
          </Button>
        </FormControl>
      )}
    </Box>
  )
}

function AuditLog({ entries }) {
  if (!entries?.length) return null
  return (
    <Box as="ul" sx={{ listStyle: 'none', paddingLeft: 0, marginTop: 3 }}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <Text className="ev-muted" sx={{ fontSize: 0 }}>
            {entry.action} · {entry.admin_username || entry.admin_user_id} ·{' '}
            {new Date(entry.created_at).toLocaleString('pt-BR')}
            {entry.reason ? ` · ${entry.reason}` : ''}
          </Text>
        </li>
      ))}
    </Box>
  )
}

// /admin/exercicios -- painel completo de criação/edição/publicação/retirada do catálogo oficial
// (seções Exercícios/Novo exercício/Em revisão/Retirados do prompt). Compõe DOIS hooks
// independentes: useAdminExerciseCatalog (conteúdo/ciclo de vida, este arquivo) e
// useAdminExerciseVisuals (mídia START/END, reaproveitado sem alteração) -- sincronizados para
// que selecionar um exercício aqui também carregue o painel de imagens dele.
export default function AdminExerciseCatalog() {
  const online = useOnlineStatus()
  const catalog = useAdminExerciseCatalog()
  const visuals = useAdminExerciseVisuals()
  const [searchDraft, setSearchDraft] = useState('')
  const { list, page, selected } = catalog

  useEffect(() => {
    visuals.select(catalog.selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.selected?.id])

  // visuals.coverage só ganha uma referência nova depois de publish:/restore: (useAdminExerciseVisuals
  // já recarrega a cobertura só nesses dois casos -- os únicos que podem mudar
  // published_media_refs; reject/delete nunca tocam a versão publicada). Reusa esse sinal já
  // existente para atualizar o indicador verde/filtro "sem imagem" da listagem, sem nenhuma
  // consulta nova; pula a própria carga inicial (catalog.loadList() já roda sozinho no mount).
  const didMountCoverageRef = useRef(false)
  useEffect(() => {
    if (!didMountCoverageRef.current) {
      didMountCoverageRef.current = true
      return
    }
    catalog.loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visuals.coverage])

  const lastPage = Math.max(Math.ceil(list.total / visuals.pageSize) - 1, 0)
  // visuals.select() roda num efeito (depois do commit que trocou catalog.selected) -- entre o
  // clique e o efeito rodar, visuals.selected ainda é o valor antigo (ou null). Só monta
  // ExerciseVisualDetail quando os dois hooks já apontam pro MESMO exercício; senão ele lê
  // `selected.primary_muscle` de um `selected` nulo/desatualizado e quebra.
  const visualsReady = Boolean(selected && visuals.selected && visuals.selected.id === selected.id)

  return (
    <div className="ev-page">
      <AdminNav current="/admin/exercicios" currentLabel="Exercícios" />
      <header className="ev-header">
        <h1>Catálogo Evolutus — administração</h1>
        <p>Crie, edite, publique e retire exercícios oficiais. Imagens START/END ficam no mesmo painel.</p>
      </header>

      {!online && (
        <Flash variant="warning" role="status">
          Sem conexão. Salvar, publicar, retirar e gerenciar imagens exige internet.
        </Flash>
      )}

      <CoverageStats coverage={visuals.coverage} />

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginBottom: 3 }} role="tablist" aria-label="Seções do catálogo">
        {SECTIONS.map((s) => (
          <Button
            key={s.key}
            role="tab"
            aria-selected={catalog.section === s.key}
            variant={catalog.section === s.key ? 'primary' : 'default'}
            onClick={() => catalog.selectSection(s.key)}
          >
            {s.label}
          </Button>
        ))}
      </Box>

      <div className="ev-toolbar">
        <form
          className="ev-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            catalog.search(searchDraft)
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
            checked={catalog.filters.onlyMissingImages}
            onChange={catalog.toggleOnlyMissingImages}
          />
          <span>Somente sem imagem</span>
        </label>
        <Button leadingVisual={PlusIcon} onClick={catalog.startNewDraft}>
          Novo exercício
        </Button>
      </div>

      <div className="exercise-visuals-layout">
        <section className="ev-list" aria-label="Exercícios">
          <h2 className="ev-eyebrow">{SECTIONS.find((s) => s.key === catalog.section)?.label}</h2>
          {catalog.listError && <Flash variant="danger">{catalog.listError.message}</Flash>}
          <div className="ev-list-scroll">
            {catalog.listLoading ? (
              <div className="ev-loading">
                <Spinner />
              </div>
            ) : list.data.length === 0 ? (
              <p className="ev-muted">Nenhum exercício nesta seção.</p>
            ) : (
              <ul>
                {list.data.map((exercise) => (
                  <ExerciseRow
                    key={exercise.id}
                    exercise={exercise}
                    active={selected?.id === exercise.id}
                    onSelect={catalog.select}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="ev-pager">
            <Button size="small" disabled={page === 0 || catalog.listLoading} onClick={() => catalog.setPage(page - 1)}>
              Anterior
            </Button>
            <span className="ev-muted">
              Página {page + 1} de {lastPage + 1} · {list.total} exercícios
            </span>
            <Button size="small" disabled={page >= lastPage || catalog.listLoading} onClick={() => catalog.setPage(page + 1)}>
              Próxima
            </Button>
          </div>
        </section>

        <section className="ev-detail" aria-label="Detalhe do exercício">
          <h2 className="ev-eyebrow">{selected ? selected.name : 'Novo exercício'}</h2>
          {catalog.actionError && (
            <Flash variant="danger" role="alert">
              {catalog.actionError}
            </Flash>
          )}
          {catalog.actionMessage && (
            <Flash variant="success" role="status">
              {catalog.actionMessage}
            </Flash>
          )}
          <ContentForm catalog={catalog} />
          <LifecycleActions catalog={catalog} />
          <AuditLog entries={catalog.auditLog} />

          {selected && (
            <Box sx={{ marginTop: 4, borderTop: '1px solid', borderColor: 'border.default', paddingTop: 3 }}>
              <h3 className="ev-eyebrow">Imagens (início/fim)</h3>
              {visualsReady ? (
                <ExerciseVisualDetail key={selected.id} visuals={visuals} online={online} />
              ) : (
                <Spinner />
              )}
            </Box>
          )}
        </section>
      </div>
    </div>
  )
}
