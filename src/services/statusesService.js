import { supabase } from '../supabase/config'

const UPCOMING_WORKOUTS_PAGE_SIZE = 20
// Um pouco acima de MAX_OUTPUT_BYTES (utils/imageCompression.js) só de folga — nunca
// deveria ter um objeto maior que isso no bucket, pois ele recusa upload além desse teto.
const MAX_PHOTO_DOWNLOAD_BYTES = 5 * 1024 * 1024
const STATUS_SUMMARY_COLUMNS =
  'id,community_id,author_id,author_username,author_is_superadmin,type,created_at,expires_at,retention_mode,comments_close_at,promoted,promoted_until,text,poll_question,poll_options,workout_title,workout_date,workout_location,achievement_day,achievement_text,achievement_entries,achievement_sets,photo_caption,progress_kind,progress_period_start,progress_period_end'

// Nome/selo são dicas de compatibilidade para o banco antigo; o banco atualizado
// os sobrescreve. Retenção, promoção e contadores pertencem exclusivamente ao servidor.
function baseStatusFields(communityId, author, type) {
  return {
    community_id: communityId,
    author_id: author.id,
    author_username: author.username || null,
    author_is_superadmin: author.role === 'superadmin',
    type,
  }
}

export function mapStatusRow(row) {
  const base = {
    id: row.id,
    communityId: row.community_id,
    authorId: row.author_id,
    authorUsername: row.author_username,
    authorIsSuperAdmin: row.author_is_superadmin,
    type: row.type,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    retentionMode: row.retention_mode,
    commentsCloseAt: row.comments_close_at,
    promoted: row.promoted,
    promotedUntil: row.promoted_until,
    activePromotionId: row.active_promotion_id,
    // Totais de reação denormalizados em statuses (cast_vote os mantém). Sem mapeá-los aqui, todo
    // carregamento da página os deixava undefined (exibidos como 0) e só o delta local da sessão os
    // fazia subir -- por isso "voltavam a zero" ao atualizar.
    positiveVoteCount: row.positive_vote_count ?? 0,
    negativeVoteCount: row.negative_vote_count ?? 0,
    commentCount: row.comment_count ?? 0,
  }
  switch (row.type) {
    case 'text':
      return { ...base, text: row.text }
    case 'poll':
      return { ...base, poll: { question: row.poll_question, options: row.poll_options } }
    case 'workout':
      return {
        ...base,
        workout: {
          title: row.workout_title,
          date: row.workout_date,
          location: row.workout_location,
        },
      }
    case 'achievement':
      return {
        ...base,
        achievement: {
          day: row.achievement_day,
          text: row.achievement_text,
          entries: row.achievement_entries,
          sets: row.achievement_sets,
        },
      }
    case 'photo':
      return {
        ...base,
        photoPath: row.photo_path,
        caption: row.photo_caption,
        // Card de progresso compartilhado (foto + metadado): null para fotos comuns.
        progress: row.progress_kind
          ? {
              kind: row.progress_kind,
              periodStart: row.progress_period_start,
              periodEnd: row.progress_period_end,
            }
          : null,
      }
    default:
      return base
  }
}

// Colunas que o card do feed realmente usa (mapStatusRow): evita levar a linha inteira (select *).
export const FEED_COLUMNS =
  'id,community_id,author_id,author_username,author_is_superadmin,type,created_at,expires_at,retention_mode,comments_close_at,promoted,promoted_until,active_promotion_id,positive_vote_count,negative_vote_count,comment_count,text,poll_question,poll_options,workout_title,workout_date,workout_location,achievement_day,achievement_text,achievement_entries,achievement_sets,photo_path,photo_caption,progress_kind,progress_period_start,progress_period_end'

// Tamanho da página do feed: pequeno para abrir rápido e gastar pouco em celular/rede ruins;
// as próximas páginas só vêm quando o usuário chega perto do fim.
export const FEED_PAGE_SIZE = 10

// Paginação por cursor (created_at desc, id desc como desempate estável): sem OFFSET, não repete
// nem pula itens quando entram publicações novas, e usa statuses_community_created_idx.
// Pede pageSize + 1 linhas só para saber se há próxima página, sem um count(*) à parte.
// cursor = { createdAt, id } do último item já carregado (createdAt na forma original do banco).
// O cursor sai de uma publicação já recebida do servidor, mas é interpolado numa string de filtro do
// PostgREST: valida o formato (timestamp ISO e uuid) para que um valor adulterado nunca vire sintaxe de
// filtro. (O RLS já impede qualquer acesso indevido; isto evita requisições malformadas.)
const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
const CURSOR_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function isValidFeedCursor(cursor) {
  return (
    typeof cursor?.createdAt === 'string' &&
    typeof cursor?.id === 'string' &&
    CURSOR_TIMESTAMP.test(cursor.createdAt) &&
    CURSOR_ID.test(cursor.id)
  )
}

export async function listCommunityFeedPage(
  communityId,
  { cursor = null, pageSize = FEED_PAGE_SIZE, signal = null } = {}
) {
  if (cursor && !isValidFeedCursor(cursor)) throw new Error('INVALID_FEED_CURSOR')
  let query = supabase
    .from('statuses')
    .select(FEED_COLUMNS)
    .eq('community_id', communityId)
    // expires_at nulo = sem expiração automática (retention_mode no_auto_expiration).
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1)
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    )
  }
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw error
  return { items: data.slice(0, pageSize).map(mapStatusRow), hasMore: data.length > pageSize }
}

// Prévia "viva" dos cartões de Minhas comunidades: só a publicação mais recente de cada
// comunidade. UMA requisição (comunidades com `statuses` embutido, limit 1 POR comunidade —
// o PostgREST aplica o limite do recurso embutido a cada linha pai) em vez de uma por
// comunidade, mais uma leitura em lote dos avatares dos autores. Uma consulta plana
// "últimas N publicações das minhas comunidades" não serve: uma comunidade muito ativa
// ocupa todas as N linhas e esvazia as demais. statuses_select já restringe a leitura a
// membros (e superadmin) e statuses_community_created_idx cobre a ordenação.
const ACTIVITY_PREVIEW_COLUMNS =
  'id,community_id,author_id,author_username,type,created_at,text,poll_question,workout_title,achievement_text,photo_caption'
// IDs por requisição: mantém a URL curta (cada uuid tem ~37 caracteres) sem limitar quantas
// comunidades têm prévia. Quem está em até ACTIVITY_BATCH_SIZE comunidades faz 1 requisição
// de publicações; acima disso, ceil(N / ACTIVITY_BATCH_SIZE) em paralelo (nunca 1 por
// comunidade; o teto de associações do app é 200, ou seja, no máximo 5 lotes).
export const ACTIVITY_BATCH_SIZE = 40

function chunk(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export function buildCommunityActivity(rows, avatars = {}) {
  const byCommunity = {}
  rows.forEach((row) => {
    const latest = row.statuses?.[0]
    if (!latest) return
    const status = mapStatusRow(latest)
    byCommunity[row.id] = { ...status, authorAvatarPath: avatars[status.authorId] || null }
  })
  return byCommunity
}

async function listActivityBatch(ids, nowIso) {
  const { data, error } = await supabase
    .from('communities')
    .select(`id,statuses(${ACTIVITY_PREVIEW_COLUMNS})`)
    .in('id', ids)
    // expires_at nulo = sem expiração automática (retention_mode no_auto_expiration).
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`, { referencedTable: 'statuses' })
    .order('created_at', { referencedTable: 'statuses', ascending: false })
    .limit(1, { referencedTable: 'statuses' })
  if (error) throw error
  return data
}

// checkedIds = comunidades cuja leitura deu certo: só delas a tela pode afirmar "sem
// publicações". Um lote que falha não derruba os demais (suas comunidades ficam sem prévia e
// sem essa afirmação) e `partial` avisa o chamador para não memorizar o resultado incompleto.
// Se TODOS os lotes falharem, lança (a tela trata a prévia como secundária).
export async function listLatestCommunityActivity(communityIds) {
  const ids = [...new Set(communityIds)]
  if (ids.length === 0) return { activity: {}, checkedIds: [], partial: false }
  const nowIso = new Date().toISOString()
  const batches = chunk(ids, ACTIVITY_BATCH_SIZE)
  const settled = await Promise.allSettled(batches.map((batch) => listActivityBatch(batch, nowIso)))
  const failed = settled.filter((result) => result.status === 'rejected')
  if (failed.length === settled.length) throw failed[0].reason
  failed.forEach((result) =>
    console.error('[statusesService] listLatestCommunityActivity batch:', result.reason)
  )

  const rows = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  const checkedIds = batches.flatMap((batch, index) =>
    settled[index].status === 'fulfilled' ? batch : []
  )
  const authorIds = [...new Set(rows.map((row) => row.statuses?.[0]?.author_id).filter(Boolean))]
  const avatars = {}
  if (authorIds.length > 0) {
    // Avatar é enfeite: se falhar, a prévia aparece com a inicial do autor.
    const profileResults = await Promise.allSettled(
      chunk(authorIds, ACTIVITY_BATCH_SIZE).map(async (batch) => {
        const { data, error } = await supabase
          .from('public_profiles')
          .select('user_id,avatar_path')
          .in('user_id', batch)
        if (error) throw error
        return data
      })
    )
    profileResults.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('[statusesService] listLatestCommunityActivity avatars:', result.reason)
        return
      }
      result.value.forEach((row) => (avatars[row.user_id] = row.avatar_path || null))
    })
  }
  return {
    activity: buildCommunityActivity(rows, avatars),
    checkedIds,
    partial: failed.length > 0,
  }
}

export async function createTextStatus(communityId, author, text) {
  const { data, error } = await supabase
    .from('statuses')
    .insert({ ...baseStatusFields(communityId, author, 'text'), text: text.trim() })
    .select('id')
    .single()
  if (error) throw error
  return data
}

export async function createPollStatus(communityId, author, question, options) {
  const { data, error } = await supabase
    .from('statuses')
    .insert({
      ...baseStatusFields(communityId, author, 'poll'),
      poll_question: question.trim(),
      poll_options: options.map((label, index) => ({ id: String(index), label: label.trim() })),
    })
    .select('id')
    .single()
  if (error) throw error
  return data
}

export async function createWorkoutStatus(communityId, author, workout) {
  const { data, error } = await supabase
    .from('statuses')
    .insert({
      ...baseStatusFields(communityId, author, 'workout'),
      workout_title: workout.title.trim(),
      workout_date: new Date(workout.date).toISOString(),
      workout_location: workout.location.trim(),
    })
    .select('id')
    .single()
  if (error) throw error
  return data
}

// Faz upload via XMLHttpRequest direto no endpoint REST do Storage em vez do
// supabase-js (que não expõe progresso nem cancelamento de upload) — assim mantém o
// mesmo comportamento de antes (barra de progresso real + botão de cancelar).
async function uploadWithProgress(objectPath, blob, { onProgress, signal } = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return new Promise((resolve, reject) => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/status-photos/${objectPath}`
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${session?.access_token}`)
    xhr.setRequestHeader('apikey', import.meta.env.VITE_SUPABASE_ANON_KEY)
    xhr.setRequestHeader('Content-Type', 'image/webp')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error('UPLOAD_FAILED'))
    }
    xhr.onerror = () => reject(new Error('UPLOAD_FAILED'))
    xhr.onabort = () => {
      const err = new Error('Upload cancelado')
      err.code = 'storage/canceled'
      reject(err)
    }
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(blob)
  })
}

// O registro nasce antes do upload. A criação dele passa pelas policies completas
// (termos, restrições, filiação e configuração da comunidade), e a policy de Storage
// só precisa consultar esse registro para autorizar os bytes. Se o envio falhar ou for
// cancelado, removemos o registro; o gatilho de exclusão e a varredura de órfãos
// (ainda não portada) continuam sendo a rede de segurança para falhas de rede.
export async function createPhotoStatus(
  communityId,
  author,
  { blob, caption, progress = null },
  { onProgress } = {}
) {
  const statusId = crypto.randomUUID()
  const photoPath = `statusPhotos/${communityId}/${statusId}.webp`
  const objectPath = `${communityId}/${statusId}.webp`

  const { error: insertError } = await supabase.from('statuses').insert({
    id: statusId,
    ...baseStatusFields(communityId, author, 'photo'),
    photo_path: photoPath,
    photo_caption: caption ? caption.trim() : '',
    ...(progress
      ? {
          progress_kind: progress.kind,
          progress_period_start: progress.periodStart,
          progress_period_end: progress.periodEnd,
        }
      : {}),
  })
  if (insertError) throw insertError

  const controller = new AbortController()
  const done = uploadWithProgress(objectPath, blob, { onProgress, signal: controller.signal }).then(
    () => ({ id: statusId }),
    async (error) => {
      await supabase
        .from('statuses')
        .delete()
        .eq('id', statusId)
        .catch(() => {})
      throw error
    }
  )
  return { task: { cancel: () => controller.abort() }, done }
}

export async function getStatusPhotoBlob(photoPath) {
  const objectPath = photoPath.replace(/^statusPhotos\//, '')
  const { data, error } = await supabase.storage.from('status-photos').download(objectPath)
  if (error) throw error
  if (data.size > MAX_PHOTO_DOWNLOAD_BYTES) throw new Error('PHOTO_TOO_LARGE')
  return data
}

export async function deleteStatus(statusId) {
  const { error } = await supabase.from('statuses').delete().eq('id', statusId)
  if (error) throw error
}

// Uma única query agregada no servidor (get_poll_results) — nunca escala com o número
// de opções nem de votos. optionIds sem nenhum voto entram com 0 (mesmo shape do
// original, que consultava cada opção explicitamente).
export async function getPollResults(statusId, optionIds) {
  const { data, error } = await supabase.rpc('get_poll_results', { p_status_id: statusId })
  if (error) throw error
  const counts = Object.fromEntries(optionIds.map((id) => [id, 0]))
  for (const row of data) counts[row.option_id] = Number(row.votes)
  return counts
}

export async function voteOnPoll(statusId, userId, optionId) {
  const { error } = await supabase
    .from('status_votes')
    .upsert({ status_id: statusId, user_id: userId, option_id: optionId })
  if (error) throw error
}

// Contagem real de confirmados (RPC): a leitura direta de status_participants só enxerga a PRÓPRIA linha
// (RLS), então um count(*) direto mostraria 0/1 para qualquer pessoa.
export async function countParticipants(statusId) {
  const { data, error } = await supabase.rpc('count_workout_participants', { p_status_id: statusId })
  if (error) throw error
  return data ?? 0
}

export async function joinWorkout(statusId, userId) {
  const { error } = await supabase.from('status_participants').insert({ status_id: statusId, user_id: userId })
  if (error) throw error
}

export async function leaveWorkout(statusId, userId) {
  const { error } = await supabase
    .from('status_participants')
    .delete()
    .eq('status_id', statusId)
    .eq('user_id', userId)
  if (error) throw error
}

// "Próximos treinos" (Treino Marcado V1) — consulta própria, independente do feed
// recente (que filtra por expires_at, sem relação com a data do evento).
export async function listUpcomingWorkouts(communityId, pageSize = UPCOMING_WORKOUTS_PAGE_SIZE) {
  const { data, error } = await supabase
    .from('statuses')
    .select(FEED_COLUMNS)
    .eq('community_id', communityId)
    .eq('type', 'workout')
    .gt('workout_date', new Date().toISOString())
    .order('workout_date', { ascending: true })
    .limit(pageSize)
  if (error) throw error
  return data.map(mapStatusRow)
}

// Resolve o alvo de um link #treino-{id} / #publicacao-{id} (qualquer tipo de publicação)
// mesmo quando ficou fora da primeira página do feed: 1 leitura por ID canônico, sem
// carregar páginas do feed. Sujeito à mesma policy de statuses/{id}: só membro da
// comunidade do próprio status consegue lê-lo; inexistente/removida/de outra comunidade
// devolve null.
export async function getSharedStatus(statusId, communityId) {
  const { data, error } = await supabase
    .from('statuses')
    .select(FEED_COLUMNS)
    .eq('id', statusId)
    .eq('community_id', communityId)
    .maybeSingle()
  if (error) throw error
  return data ? mapStatusRow(data) : null
}

// Leitura pontual usada pelo contexto de comentário. Não carrega o feed nem relações
// interativas (votos/participantes); retorna apenas os campos necessários ao resumo.
export async function getStatusSummary(statusId) {
  const { data, error } = await supabase
    .from('statuses')
    .select(STATUS_SUMMARY_COLUMNS)
    .eq('id', statusId)
    .maybeSingle()
  if (error) throw error
  return data ? mapStatusRow(data) : null
}

// "Ver participantes" -- via RPC list_workout_participants (security definer, fail-closed, só quem
// enxerga a publicação). Não dá para fazer o embed `public_profiles(username)` direto em
// status_participants (PGRST200: as duas tabelas só se ligam a users, não entre si) e a RLS de
// status_participants só libera a própria linha. Devolve só { userId, username }; username null (conta
// sem perfil público) vira "Membro" na UI. cursor é o nextCursor da página anterior ({ at, userId }).
export async function listWorkoutParticipants(statusId, { cursor = null, limit = 20 } = {}) {
  const { data, error } = await supabase.rpc('list_workout_participants', {
    p_status_id: statusId,
    p_cursor_at: cursor?.at ?? null,
    p_cursor_user: cursor?.userId ?? null,
    p_limit: limit,
  })
  if (error) throw error
  return { participants: data?.participants ?? [], nextCursor: data?.nextCursor ?? null }
}
