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

// Comparação confiável entre o formulário atual e a última versão salva/carregada: só os campos
// de conteúdo editáveis entram (nunca metadados como id/status), e a ordem dos campos é fixa --
// JSON.stringify de um objeto com chaves sempre na mesma ordem é uma igualdade estrutural válida
// aqui (todo valor é string ou array de string, nunca Date/undefined/circular).
function serializeFormState(form) {
  return JSON.stringify({
    name: form.name,
    primaryMuscle: form.primaryMuscle,
    muscles: form.muscles,
    equipment: form.equipment,
    category: form.category,
    difficulty: form.difficulty,
    force: form.force,
    mechanic: form.mechanic,
    instructions: form.instructions,
    safetyNotes: form.safetyNotes,
  })
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
  const [filters, setFilters] = useState({ search: '', muscle: '', onlyMissingImages: false })
  const [page, setPage] = useState(0)
  const [list, setList] = useState({ data: [], total: 0 })
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState(null)

  const [selected, setSelected] = useState(null)
  const [formState, setFormState] = useState(EMPTY_FORM)
  // Última versão salva/carregada do formulário -- a referência contra a qual "há alteração
  // real?" é decidida. Nunca a mesma referência de objeto que formState (cada edição de campo
  // só muda formState), então uma comparação por valor (serializeFormState) é que decide.
  const [formBaseline, setFormBaseline] = useState(EMPTY_FORM)
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
        onlyMissingImages: filters.onlyMissingImages,
      })
      if (request === listRequest.current) {
        const lastPage = Math.max(Math.ceil(result.total / PAGE_SIZE) - 1, 0)
        if (page > lastPage) setPage(lastPage)
        else setList(result)
      }
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
    const next = toFormState(row)
    setSelected(row)
    setFormState(next)
    setFormBaseline(next)
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

  function toggleOnlyMissingImages() {
    setPage(0)
    setFilters((current) => ({ ...current, onlyMissingImages: !current.onlyMissingImages }))
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
      // Depois de qualquer ação bem-sucedida o formulário passa a refletir o que o servidor
      // confirmou -- essa é a nova versão "limpa": Salvar volta a ficar desabilitado até uma
      // edição de verdade acontecer de novo.
      const next = toFormState(result)
      setFormState(next)
      setFormBaseline(next)
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

  // Só true quando o formulário realmente diverge da última versão salva/carregada -- nunca
  // porque o usuário clicou em algum campo sem mudar o valor.
  const isDirty = serializeFormState(formState) !== serializeFormState(formBaseline)

  const saveContent = () => {
    // Nada mudou: não gasta requisição, não incrementa revisão, não grava auditoria.
    if (!isDirty) return Promise.resolve(false)
    return run('save', () =>
      selected ? updateCatalogContent(selected.id, formState) : createCatalogDraft(formState)
    )
  }
  const submitForReview = () => run('submit', () => submitCatalogForReview(selected.id))
  const publish = () => run('publish', () => publishCatalogExercise(selected.id))
  const withdraw = () => run('withdraw', () => withdrawCatalogExercise(selected.id, withdrawReason))
  const restore = () => run('restore', () => restoreCatalogExercise(selected.id))

  return {
    section,
    filters,
    page,
    pageSize: PAGE_SIZE,
    setPage,
    list,
    listLoading,
    listError,
    loadList,
    selected,
    formState,
    isDirty,
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
    toggleOnlyMissingImages,
    saveContent,
    submitForReview,
    publish,
    withdraw,
    restore,
  }
}

export { PAGE_SIZE }
