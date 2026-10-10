import {
  readCatalogSnapshotMeta,
  replaceCatalogSnapshot,
  touchCatalogSnapshotCheckedAt,
} from './exerciseCache.js'
import { withSyncLock } from './syncLock.js'

// Import DINÂMICO de propósito (não estático no topo do arquivo): exerciseCatalogService.js
// importa supabase/config sem extensão (resolvido pelo Vite, não por `node --test` puro -- mesma
// limitação documentada em exerciseCatalogService.test.js). Como toda chamada de rede real deste
// módulo passa por `deps` (testável sem tocar supabase/config nunca), só carregamos o serviço de
// verdade quando ALGUÉM não injeta a dependência -- nenhum teste daqui chega a importar o módulo
// real, e em produção (Vite) o import dinâmico resolve exatamente como o estático resolveria.
let servicePromise = null
function loadCatalogService() {
  if (!servicePromise) servicePromise = import('../exerciseCatalogService.js')
  return servicePromise
}

// Sincronização completa do catálogo (todos os exercícios ativos) para uso offline --
// docs/prompts/EVOLUTUS_PROMPT_CATALOGO_OFFLINE_COMPLETO.md seção 3. Tudo aqui é opt-in: chamado
// pela UI do Catálogo (primeira visita com rede, botão "Preparar"/"Atualizar"), nunca no boot.
//
// Custo/consumo controlado:
//  - varredura por keyset em `id` (list_exercise_catalog_for_sync), página de 50 (teto real do
//    servidor) -- ~18 chamadas para ~870 exercícios ativos, sem revalidar total_count por página
//    (keyset já é imune a linhas que mudam de posição entre chamadas).
//  - fora da janela de verificação (24h) e sem `force`, ZERO chamadas de rede: só lê o snapshot local.
//  - dentro da janela/força, só UMA chamada de revisão (RPC get_exercise_catalog_revision) antes de
//    decidir se vale a pena baixar tudo de novo; se a RPC não existir ainda (migration não aplicada)
//    ou falhar, cai para a política de janela amortizada (documentada abaixo).
const CHECK_WINDOW_MS = 24 * 60 * 60 * 1000
const SAFETY_MAX_PAGES = 200 // 200 * 50 = 10000, bem acima do catálogo real (~870)
const PAGE_LIMIT = 50 // mesmo teto do servidor (least(greatest(p_limit,1),50))

function isOnline() {
  return globalThis.navigator?.onLine !== false
}

// Baixa TODO o catálogo ativo em memória (sem tocar IndexedDB) -- quem chama só grava depois de
// validar que a varredura terminou sem erro, nunca no meio de uma transação IndexedDB (que não
// pode `await` rede).
export async function downloadFullCatalog({ onProgress, deps = {} } = {}) {
  const fetchPage = deps.fetchCatalogSyncPage ?? (await loadCatalogService()).fetchCatalogSyncPage
  const exercises = []
  let afterId = null
  for (let page = 0; page < SAFETY_MAX_PAGES; page += 1) {
    const batch = await fetchPage({ afterId, limit: PAGE_LIMIT })
    exercises.push(...batch)
    onProgress?.({ downloaded: exercises.length })
    if (batch.length < PAGE_LIMIT) return exercises
    afterId = batch[batch.length - 1].id
  }
  throw new Error('Varredura do catálogo excedeu o teto de segurança de páginas')
}

// true = vale a pena gastar a chamada de revisão (force, nunca sincronizou completo, ou a janela
// de 24h já passou). Pura, sem rede -- só decide SE checa, não decide se baixa.
export function needsRevisionCheck(meta, { force = false, now = Date.now() } = {}) {
  if (!meta?.complete) return false // sem snapshot completo não há o que comparar: baixa direto
  if (force) return true
  return now - (meta.lastCheckedAt ?? 0) >= CHECK_WINDOW_MS
}

// Dada uma revisão (ou null quando indisponível), decide se precisa baixar tudo de novo. Pura.
export function needsDownload(meta, { revision, revisionChecked } = {}) {
  if (!meta?.complete) return true
  if (!revisionChecked) return false // ainda dentro da janela, sem motivo pra suspeitar de mudança
  if (revision == null) return true // RPC de revisão indisponível: política de janela amortizada já decidiu checar
  return revision !== meta.revision
}

async function decide(meta, { force, now }, deps) {
  if (!needsRevisionCheck(meta, { force, now })) {
    return { download: needsDownload(meta, { revisionChecked: false, now }), revision: meta?.revision ?? null }
  }
  const fetchRevision = deps.fetchCatalogRevision ?? (await loadCatalogService()).fetchCatalogRevision
  let revision = null
  try {
    revision = (await fetchRevision())?.revision ?? null
  } catch {
    revision = null // sem suporte ainda (42883) ou rede: cai pra baixar (janela já tinha passado)
  }
  return { download: needsDownload(meta, { revision, revisionChecked: true, now }), revision }
}

async function runDownloadAndReplace({ revision, onProgress }, deps) {
  const now = (deps.now ?? Date.now)()
  const replace = deps.replaceCatalogSnapshot ?? replaceCatalogSnapshot
  const touch = deps.touchCatalogSnapshotCheckedAt ?? touchCatalogSnapshotCheckedAt
  try {
    const exercises = await downloadFullCatalog({ onProgress, deps })
    const ok = await replace(exercises, { revision, now })
    if (!ok) {
      await touch(now)
      return { status: 'unavailable' }
    }
    return { status: 'synced', total: exercises.length }
  } catch (error) {
    // Interrompido no meio (rede caiu, teto de segurança): o snapshot ANTERIOR nunca é tocado --
    // replaceCatalogSnapshot só é chamado com a lista COMPLETA e validada, nunca parcial.
    await touch(now)
    return { status: 'error', error }
  }
}

// Dedup na MESMA aba: duas chamadas concorrentes (ex.: dois componentes montando ao mesmo tempo)
// reaproveitam a mesma sincronização em curso, nunca disparam duas.
let inFlight = null

export function ensureCatalogSnapshot({ force = false, onProgress, deps = {} } = {}) {
  if (inFlight) return inFlight
  inFlight = runEnsure({ force, onProgress }, deps).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runEnsure({ force, onProgress }, deps) {
  const online = deps.isOnline ?? isOnline
  if (!online()) return { status: 'offline' }

  const readMeta = deps.readCatalogSnapshotMeta ?? readCatalogSnapshotMeta
  const touch = deps.touchCatalogSnapshotCheckedAt ?? touchCatalogSnapshotCheckedAt
  const now = (deps.now ?? Date.now)()

  const meta = await readMeta()
  const { download, revision } = await decide(meta, { force, now }, deps)
  if (!download) {
    await touch(now)
    return { status: 'skipped', meta }
  }

  // Lock ENTRE abas (Web Locks com ifAvailable -- quem não consegue não espera, só desiste; a aba
  // que já está sincronizando cuida de tudo, e esta aba lerá o resultado dela no IndexedDB
  // compartilhado na próxima leitura). Reaproveita o mesmo primitivo da sync da outbox, sem
  // alteração -- a chave só precisa ser estável para o recurso, não precisa ser um user_id real.
  const lock = deps.withSyncLock ?? withSyncLock
  const { acquired, value } = await lock('catalog-snapshot', () =>
    runDownloadAndReplace({ revision, onProgress }, deps)
  )
  if (!acquired) return { status: 'locked' }
  return value
}
