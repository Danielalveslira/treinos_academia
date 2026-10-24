import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PAGE_SIZE,
  createCatalogDraft,
  describeCatalogAdminError,
  listCatalogAuditLog,
  listCatalogExercises,
  publishCatalogExercise,
  restoreCatalogExercise,
  submitCatalogForReview,
  updateCatalogContent,
  withdrawCatalogExercise,
} from '../services/exerciseCatalogAdminService'
import { describeQueryError } from '../utils/queryError'

const EMPTY_FORM = {
  name: '',
  primaryMuscle: '',
  muscles: [],
  equipment: '',
  category: '',
  difficulty: '',
  force: '',
  mechanic: '',
  instructions: [],
  safetyNotes: [],
}

function toFormState(row) {
  // Se há edição pendente de republicação (pending_content), o formulário edita a PROPOSTA,
  // nunca o conteúdo ao vivo (ver admin_update_catalog_exercise_content, seção 1.9 da migration).
  const source = row?.pending_content || row
  if (!source) return EMPTY_FORM
  return {
    name: source.name ?? row?.name ?? '',
    primaryMuscle: source.primaryMuscle ?? source.primary_muscle ?? '',
    muscles: source.muscles ?? [],
    equipment: source.equipment ?? '',
    category: source.category ?? '',
    difficulty: source.difficulty ?? '',
    force: source.force ?? '',
    mechanic: source.mechanic ?? '',
    instructions: source.instructions ?? [],
    safetyNotes: source.safetyNotes ?? source.safety_notes ?? [],
  }
}

// Estado da página /admin/exercicios: conteúdo e ciclo de vida do catálogo oficial (criar,
// editar, submeter a revisão, publicar, retirar, restaurar). A mídia (START/END) é gerenciada
// por useAdminExerciseVisuals, composto lado a lado em AdminExerciseCatalog.jsx -- este hook
// nunca fala de imagem.
export function useAdminExerciseCatalog() {
  const [section, setSection] = useState('published') // 'published' | 'draft' | 'in_review' | 'withdrawn'
  const [filters, setFilters] = useState({ search: '', muscle: '' })
  const [page, setPage] = useState(0)
  const [list, setList] = useState({ data: [], total: 0 })
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState(null)

  const [selected, setSelected] = useState(null)
  const [formState, setFormState] = useState(EMPTY_FORM)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [auditLog, setAuditLog] = useState([])

  const [busy, setBusy] = useState(null) // 'save' | 'submit' | 'publish' | 'withdraw' | 'restore'
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const busyRef = useRef(null)
  const listRequest = useRef(0)

  const loadList = useCallback(async () => {
    const request = ++listRequest.current
    setListLoading(true)
    setListError(null)
    try {
      const result = await listCatalogExercises({
        status: section,
        search: filters.search,
        muscle: filters.muscle,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      if (request === listRequest.current) setList(result)
    } catch (error) {
      if (request === listRequest.current)
        setListError(describeQueryError(error, 'useAdminExerciseCatalog.list'))
    } finally {
      if (request === listRequest.current) setListLoading(false)
    }
  }, [section, filters, page])

  useEffect(() => {
    loadList()
  }, [loadList])

  const loadAuditLog = useCallback(async (catalogId) => {
    try {
      setAuditLog(await listCatalogAuditLog({ catalogId }))
    } catch (error) {
      describeQueryError(error, 'useAdminExerciseCatalog.auditLog')
    }
  }, [])

  function selectSection(next) {
    setSection(next)
    setPage(0)
    select(next === 'draft' && !selected ? null : selected)
  }

  function select(row) {
    setSelected(row)
    setFormState(toFormState(row))
    setWithdrawReason('')
    setActionError('')
    setActionMessage('')
    setAuditLog([])
    if (row) loadAuditLog(row.id)
  }

  function startNewDraft() {
    select(null)
    setFormState(EMPTY_FORM)
  }

  function updateFormField(field, value) {
    setFormState((current) => ({ ...current, [field]: value }))
  }

  function search(term) {
    setPage(0)
    setFilters((current) => ({ ...current, search: term }))
  }

  function setMuscleFilter(muscle) {
    setPage(0)
    setFilters((current) => ({ ...current, muscle }))
  }

  async function run(name, action) {
    if (busyRef.current) return false
    busyRef.current = name
    setBusy(name)
    setActionError('')
    setActionMessage('')
    try {
      const result = await action()
      setActionMessage(
        name === 'save'
          ? 'Rascunho salvo.'
          : name === 'submit'
            ? 'Enviado para revisão.'
            : name === 'publish'
              ? 'Publicado no Catálogo Evolutus.'
              : name === 'withdraw'
                ? 'Exercício retirado do catálogo.'
                : 'Restaurado; publique novamente para voltar ao ar.'
      )
      setSelected(result)
      setFormState(toFormState(result))
      if (name === 'withdraw') setWithdrawReason('')
      await Promise.all([loadList(), loadAuditLog(result.id)])
      return true
    } catch (error) {
      console.error(`[useAdminExerciseCatalog] ${name}:`, error)
      setActionError(describeCatalogAdminError(error))
      return false
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }

  const saveContent = () =>
    run('save', () =>
      selected ? updateCatalogContent(selected.id, formState) : createCatalogDraft(formState)
    )
  const submitForReview = () => run('submit', () => submitCatalogForReview(selected.id))
  const publish = () => run('publish', () => publishCatalogExercise(selected.id))
  const withdraw = () => run('withdraw', () => withdrawCatalogExercise(selected.id, withdrawReason))
  const restore = () => run('restore', () => restoreCatalogExercise(selected.id))

  return {
    section,
    filters,
    page,
    setPage,
    list,
    listLoading,
    listError,
    selected,
    formState,
    withdrawReason,
    setWithdrawReason,
    auditLog,
    busy,
    actionError,
    actionMessage,
    selectSection,
    select,
    startNewDraft,
    updateFormField,
    search,
    setMuscleFilter,
    saveContent,
    submitForReview,
    publish,
    withdraw,
    restore,
  }
}

export { PAGE_SIZE }
