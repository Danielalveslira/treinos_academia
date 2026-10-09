import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PAGE_SIZE,
  describeVisualError,
  getActiveStyleProfile,
  getVisualCoverage,
  listCatalogForVisuals,
  listVisualSets,
  publishVisualSet,
  rejectVisualSet,
  restoreVisualSet,
  uploadVisualSet,
} from '../services/exerciseVisualsService'
import { buildExerciseVisualPrompt, PROMPT_VERSION } from '../utils/exerciseVisualPromptBuilder'
import { describeQueryError } from '../utils/queryError'

// Estado da tela /admin/exercicios-imagens: lista paginada do catálogo (com filtro "sem imagem"),
// cobertura, exercício selecionado com seus conjuntos visuais e as ações de revisão. Tudo online-only:
// nada aqui passa pelo IndexedDB/outbox -- a mídia oficial é conteúdo global read-only para o aluno.
export function useAdminExerciseVisuals() {
  const [filters, setFilters] = useState({ q: '', onlyMissing: false })
  const [page, setPage] = useState(0)
  const [list, setList] = useState({ data: [], total: 0 })
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState(null)
  const [coverage, setCoverage] = useState(null)
  const [styleProfile, setStyleProfile] = useState(null)

  const [selected, setSelected] = useState(null)
  const [sets, setSets] = useState([])
  const [setsLoading, setSetsLoading] = useState(false)
  const [setsError, setSetsError] = useState(null)

  const [busy, setBusy] = useState(null) // 'upload' | `publish:${id}` | `reject:${id}` | `restore:${id}`
  const [actionError, setActionError] = useState('')
  const listRequest = useRef(0)
  const setsRequest = useRef(0)

  const loadList = useCallback(async () => {
    const request = ++listRequest.current
    setListLoading(true)
    setListError(null)
    try {
      const result = await listCatalogForVisuals({
        q: filters.q,
        onlyMissing: filters.onlyMissing,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      if (request === listRequest.current) setList(result)
    } catch (error) {
      if (request === listRequest.current)
        setListError(describeQueryError(error, 'useAdminExerciseVisuals.list'))
    } finally {
      if (request === listRequest.current) setListLoading(false)
    }
  }, [filters, page])

  const loadCoverage = useCallback(async () => {
    try {
      setCoverage(await getVisualCoverage())
    } catch (error) {
      describeQueryError(error, 'useAdminExerciseVisuals.coverage')
    }
  }, [])

  useEffect(() => {
    loadList()
  }, [loadList])

  useEffect(() => {
    loadCoverage()
    getActiveStyleProfile()
      .then(setStyleProfile)
      .catch((error) => describeQueryError(error, 'useAdminExerciseVisuals.styleProfile'))
  }, [loadCoverage])

  const loadSets = useCallback(async (catalogId) => {
    const request = ++setsRequest.current
    setSetsLoading(true)
    setSetsError(null)
    try {
      const result = await listVisualSets(catalogId)
      if (request === setsRequest.current) setSets(result)
    } catch (error) {
      if (request === setsRequest.current)
        setSetsError(describeQueryError(error, 'useAdminExerciseVisuals.sets'))
    } finally {
      if (request === setsRequest.current) setSetsLoading(false)
    }
  }, [])

  function select(exercise) {
    setSelected(exercise)
    setSets([])
    setActionError('')
    if (exercise) loadSets(exercise.id)
  }

  function search(q) {
    setPage(0)
    setFilters((current) => ({ ...current, q }))
  }

  function toggleOnlyMissing(onlyMissing) {
    setPage(0)
    setFilters((current) => ({ ...current, onlyMissing }))
  }

  // Executa uma ação administrativa: uma por vez, erro sempre visível, e recarrega tudo o que ela
  // pode ter mudado (conjuntos do exercício, linha da lista e cobertura).
  async function run(name, action) {
    if (busy || !selected) return false
    setBusy(name)
    setActionError('')
    try {
      await action()
      await Promise.all([loadSets(selected.id), loadList(), loadCoverage()])
      return true
    } catch (error) {
      console.error(`[useAdminExerciseVisuals] ${name}:`, error)
      setActionError(describeVisualError(error))
      return false
    } finally {
      setBusy(null)
    }
  }

  const prompt = (() => {
    if (!selected) return null
    try {
      return buildExerciseVisualPrompt(selected, styleProfile)
    } catch {
      return null
    }
  })()

  // A origem da imagem é neutra (IA de qualquer fornecedor, prompt externo ou arte própria): o registro
  // fica como upload manual e a ferramenta usada, se informada, vai só nos metadados.
  function upload({ startFile, endFile, tool }) {
    return run('upload', () =>
      uploadVisualSet({
        catalogId: selected.id,
        startFile,
        endFile,
        generationSource: 'manual_upload',
        promptVersion: PROMPT_VERSION,
        metadata: {
          promptVersion: PROMPT_VERSION,
          styleVersion: prompt?.styleVersion,
          ...(tool?.trim() ? { tool: tool.trim().slice(0, 40) } : {}),
        },
      })
    )
  }

  const approve = (setId) => run(`publish:${setId}`, () => publishVisualSet(setId))
  const reject = (setId, reason) => run(`reject:${setId}`, () => rejectVisualSet(setId, reason))
  const restore = (setId) => run(`restore:${setId}`, () => restoreVisualSet(setId))

  return {
    filters,
    page,
    setPage,
    pageSize: PAGE_SIZE,
    list,
    listLoading,
    listError,
    coverage,
    selected,
    sets,
    setsLoading,
    setsError,
    busy,
    actionError,
    prompt,
    select,
    search,
    toggleOnlyMissing,
    refresh: loadList,
    upload,
    approve,
    reject,
    restore,
  }
}
