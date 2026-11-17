import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PAGE_SIZE,
  createCatalogDraft,
  describeCatalogAdminError,
  discardCatalogPending,
  listCatalogAuditLog,
  listCatalogExercises,
  publishCatalogExercise,
  restoreCatalogExercise,
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
  if (!row) return EMPTY_FORM
  const base = {
    name: row.name ?? '', primaryMuscle: row.primary_muscle ?? '',
    muscles: row.muscles ?? [], equipment: row.equipment ?? '',
    category: row.category ?? '', difficulty: row.difficulty ?? '',
    force: row.force ?? '', mechanic: row.mechanic ?? '',
    instructions: row.instructions ?? [], safetyNotes: row.safety_notes ?? [],
  }
  const pending = row.pending_content
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) return base
  // Chave ausente preserva a versão pública. JSON null limpa somente o campo presente.
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [
    key, Object.hasOwn(pending, key) ? (pending[key] ?? (Array.isArray(value) ? [] : '')) : value,
  ]))
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
  const [fieldError, setFieldError] = useState(null)
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

  function confirmLeave() {
    return !isDirty || window.confirm('Há alterações não salvas. Deseja descartá-las?')
  }

  function selectSection(next) {
    if (!confirmLeave()) return
    setSection(next)
    setPage(0)
    select(next === 'draft' && !selected ? null : selected, true)
  }

  function select(row, skipConfirmation = false) {
    if (!skipConfirmation && !confirmLeave()) return
    const next = toFormState(row)
    setSelected(row)
    setFormState(next)
    setFormBaseline(next)
    setWithdrawReason('')
    setActionError('')
    setActionMessage('')
    setFieldError(null)
    setAuditLog([])
    if (row) loadAuditLog(row.id)
  }

  function startNewDraft() {
    if (!confirmLeave()) return
    select(null, true)
    setFormState(EMPTY_FORM)
  }

  function updateFormField(field, value) {
    setFormState((current) => ({ ...current, [field]: value }))
    if (fieldError?.field === field) setFieldError(null)
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
    setFieldError(null)
    try {
      const result = await action()
      setActionMessage(
        name === 'save'
          ? selected?.status === 'published'
            ? 'Alterações salvas. O exercício continua disponível com a versão anterior.'
            : 'Rascunho salvo.'
          : name === 'publish'
              ? selected?.status === 'published' ? 'Exercício atualizado com sucesso.' : 'Exercício publicado com sucesso.'
              : name === 'withdraw'
                ? 'Exercício retirado do catálogo.'
                : name === 'discard' ? 'Alterações pendentes descartadas.' : 'Restaurado; publique novamente para voltar ao ar.'
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
      const message = describeCatalogAdminError(error)
      const field = {
        NAME_REQUIRED: 'name', PRIMARY_MUSCLE_REQUIRED: 'primaryMuscle',
        MUSCLES_REQUIRED: 'muscles', CATEGORY_REQUIRED: 'category',
        INSTRUCTIONS_REQUIRED: 'instructions',
      }[error?.message]
      if (field) setFieldError({ field, message })
      setActionError(name === 'publish' && message === 'Não foi possível concluir a operação. Tente novamente.'
        ? 'Não foi possível publicar a alteração. A versão anterior continua disponível.' : message)
      return false
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }

  // Só true quando o formulário realmente diverge da última versão salva/carregada -- nunca
  // porque o usuário clicou em algum campo sem mudar o valor.
  const isDirty = serializeFormState(formState) !== serializeFormState(formBaseline)

  useEffect(() => {
    if (!isDirty) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  const patch = Object.fromEntries(Object.keys(formState)
    .filter((key) => JSON.stringify(formState[key]) !== JSON.stringify(formBaseline[key]))
    .map((key) => [key, Array.isArray(formState[key]) ? formState[key].filter((value) => value.trim()) : formState[key].trim() || null]))

  const saveContent = () => {
    // Nada mudou: não gasta requisição, não incrementa revisão, não grava auditoria.
    if (!isDirty) return Promise.resolve(false)
    return run('save', () =>
      selected ? updateCatalogContent(selected.id, selected.revision, patch) : createCatalogDraft(formState)
    )
  }
  const publish = () => run('publish', () => publishCatalogExercise(selected.id, selected.revision))
  const discardPending = () => {
    if (!window.confirm('Descartar as alterações ainda não publicadas?')) return Promise.resolve(false)
    return run('discard', () => discardCatalogPending(selected.id, selected.revision))
  }
  const withdraw = () => {
    if (!window.confirm('Retirar este exercício do catálogo? Ele ficará indisponível para novos treinos.')) return Promise.resolve(false)
    return run('withdraw', () => withdrawCatalogExercise(selected.id, withdrawReason))
  }
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
    fieldError,
    selectSection,
    select,
    startNewDraft,
    updateFormField,
    search,
    setMuscleFilter,
    toggleOnlyMissingImages,
    saveContent,
    publish,
    discardPending,
    withdraw,
    restore,
  }
}

export { PAGE_SIZE }
