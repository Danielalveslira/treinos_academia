import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PAGE_SIZE,
  describeVisualError,
  getActiveStyleProfile,
  getVisualCoverage,
  isDefinitiveUploadError,
  listCatalogForVisuals,
  listVisualSets,
  newUploadRequestId,
  publishVisualSet,
  rejectVisualSet,
  restoreVisualSet,
  uploadVisualSet,
} from '../services/exerciseVisualsService'
import {
  buildExerciseVisualPrompts,
  DEFAULT_PROMPT_PROVIDER,
  hashPromptText,
  PROMPT_VERSION,
} from '../utils/exerciseVisualPromptBuilder'
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
  // 'loading' | 'ready' | 'error': sem 'ready' não há prompt nem criação (nunca um perfil de reserva).
  const [styleProfileState, setStyleProfileState] = useState('loading')
  const styleProfileRequest = useRef(0)

  const [selected, setSelected] = useState(null)
  const [sets, setSets] = useState([])
  const [setsLoading, setSetsLoading] = useState(false)
  const [setsError, setSetsError] = useState(null)

  const [busy, setBusy] = useState(null) // 'upload' | `publish:${id}` | `reject:${id}` | `restore:${id}`
  const [actionError, setActionError] = useState('')
  const [promptProvider, setPromptProvider] = useState(DEFAULT_PROMPT_PROVIDER)
  // `busy` (estado) só muda no próximo render: dois cliques no mesmo instante enxergariam busy === null.
  // O ref bloqueia o segundo clique imediatamente.
  const busyRef = useRef(null)
  // Chave de idempotência do envio em andamento: o mesmo par de arquivos reenviado (retry, conexão instável)
  // reutiliza a chave e o servidor devolve o mesmo conjunto em vez de criar outro.
  const uploadKey = useRef(null)
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

  const loadStyleProfile = useCallback(async () => {
    const request = ++styleProfileRequest.current
    setStyleProfileState('loading')
    let profile = null
    try {
      profile = await getActiveStyleProfile()
    } catch (error) {
      describeQueryError(error, 'useAdminExerciseVisuals.styleProfile')
    }
    if (request !== styleProfileRequest.current) return
    const usable = profile?.id && profile?.base_prompt ? profile : null
    setStyleProfile(usable)
    setStyleProfileState(usable ? 'ready' : 'error')
  }, [])

  useEffect(() => {
    loadCoverage()
    loadStyleProfile()
  }, [loadCoverage, loadStyleProfile])

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
    if (busyRef.current || !selected) return false
    busyRef.current = name
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
      busyRef.current = null
      setBusy(null)
    }
  }

  // Dois prompts separados (uma imagem cada), no formato do provider escolhido (genérico por padrão).
  const prompts = (() => {
    if (!selected || styleProfileState !== 'ready') return null
    try {
      return buildExerciseVisualPrompts(selected, styleProfile, { provider: promptProvider })
    } catch {
      return null
    }
  })()

  // A origem da imagem é neutra (IA de qualquer fornecedor, prompt externo ou arte própria): o registro
  // fica como upload manual e a ferramenta usada, se informada, vai só nos metadados. A proveniência (versão do
  // estilo e do perfil de prompt, hash exato dos prompts START/END e formato escolhido) é gravada no conjunto.
  function upload({ startFile, endFile, tool }) {
    return run('upload', async () => {
      // Sem o perfil ativo carregado não há alocação: o registro precisa bater com o prompt mostrado.
      if (!prompts) throw new Error('STYLE_PROFILE_UNAVAILABLE')
      let key = uploadKey.current
      if (
        !key ||
        key.catalogId !== selected.id ||
        key.startFile !== startFile ||
        key.endFile !== endFile
      ) {
        key = { catalogId: selected.id, startFile, endFile, requestId: newUploadRequestId() }
        uploadKey.current = key
      }
      const [promptStartHash, promptEndHash] = await Promise.all([
        hashPromptText(prompts.start.text),
        hashPromptText(prompts.end.text),
      ])
      try {
        await uploadVisualSet({
          catalogId: selected.id,
          startFile,
          endFile,
          generationSource: 'manual_upload',
          promptVersion: PROMPT_VERSION,
          requestId: key.requestId,
          styleProfileId: prompts.start.styleProfileId,
          promptStartHash,
          promptEndHash,
          providerHint: promptProvider,
          metadata: {
            promptVersion: PROMPT_VERSION,
            styleVersion: prompts.start.styleVersion,
            ...(tool?.trim() ? { tool: tool.trim().slice(0, 40) } : {}),
          },
        })
        uploadKey.current = null
      } catch (error) {
        // Erro definitivo do servidor: o próximo envio precisa de uma alocação nova.
        if (isDefinitiveUploadError(error)) uploadKey.current = null
        throw error
      }
    })
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
    prompts,
    styleProfileState,
    reloadStyleProfile: loadStyleProfile,
    promptProvider,
    setPromptProvider,
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
