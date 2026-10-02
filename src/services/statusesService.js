import { supabase } from '../supabase/config'
import { validateAchievement } from '../utils/achievements'

const FEED_PAGE_SIZE = 30
const UPCOMING_WORKOUTS_PAGE_SIZE = 20
const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000
// Um pouco acima de MAX_OUTPUT_BYTES (utils/imageCompression.js) só de folga — nunca
// deveria ter um objeto maior que isso no bucket, pois ele recusa upload além desse teto.
const MAX_PHOTO_DOWNLOAD_BYTES = 5 * 1024 * 1024

function expiresAtValue() {
  return new Date(Date.now() + STATUS_LIFETIME_MS).toISOString()
}

// author_is_superadmin (selo dourado) é só a conveniência de exibição — o valor
// enviado aqui é ignorado pelo banco (trigger enforce_status_author_badge sobrescreve
// com o papel real de quem está autenticado), igual à regra equivalente do main.
function baseStatusFields(communityId, author, type) {
  return {
    community_id: communityId,
    author_id: author.id,
    author_username: author.username || null,
    author_is_superadmin: author.role === 'superadmin',
    type,
    expires_at: expiresAtValue(),
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
    promoted: row.promoted,
    promotedUntil: row.promoted_until,
    activePromotionId: row.active_promotion_id,
  }
  switch (row.type) {
    case 'text':
      return { ...base, text: row.text }
    case 'poll':
      return { ...base, poll: { question: row.poll_question, options: row.poll_options } }
    case 'workout':
      return {
        ...base,
        workout: { title: row.workout_title, date: row.workout_date, location: row.workout_location },
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
      return { ...base, photoPath: row.photo_path, caption: row.photo_caption }
    default:
      return base
  }
}

export async function listCommunityFeed(communityId, pageSize = FEED_PAGE_SIZE) {
  const { data, error } = await supabase
    .from('statuses')
    .select('*')
    .eq('community_id', communityId)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(pageSize)
  if (error) throw error
  return data.map(mapStatusRow)
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
export async function createPhotoStatus(communityId, author, { blob, caption }, { onProgress } = {}) {
  const statusId = crypto.randomUUID()
  const photoPath = `statusPhotos/${communityId}/${statusId}.webp`
  const objectPath = `${communityId}/${statusId}.webp`

  const { error: insertError } = await supabase.from('statuses').insert({
    id: statusId,
    ...baseStatusFields(communityId, author, 'photo'),
    photo_path: photoPath,
    photo_caption: caption ? caption.trim() : '',
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

export async function getMyVote(statusId, userId) {
  const { data, error } = await supabase
    .from('status_votes')
    .select('*')
    .eq('status_id', statusId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data ? { optionId: data.option_id, userId: data.user_id, createdAt: data.created_at } : null
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

export async function amIParticipant(statusId, userId) {
  const { data, error } = await supabase
    .from('status_participants')
    .select('user_id')
    .eq('status_id', statusId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return !!data
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
    .select('*')
    .eq('community_id', communityId)
    .eq('type', 'workout')
    .gt('workout_date', new Date().toISOString())
    .order('workout_date', { ascending: true })
    .limit(pageSize)
  if (error) throw error
  return data.map(mapStatusRow)
}

// Resolve o alvo de um link #treino-{id} mesmo quando ficou fora do limite da consulta
// acima. Sujeito à mesma policy de statuses/{id}: só membro da comunidade do próprio
// status consegue lê-lo.
export async function getSharedWorkout(statusId, communityId) {
  const { data, error } = await supabase.from('statuses').select('*').eq('id', statusId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const status = mapStatusRow(data)
  return status.type === 'workout' && status.communityId === communityId ? status : null
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

export async function createAchievementStatus(communityId, author, values) {
  const error = validateAchievement(values)
  if (error) throw new Error(error)
  const { data, error: insertError } = await supabase
    .from('statuses')
    .insert({
      ...baseStatusFields(communityId, author, 'achievement'),
      achievement_day: values.day,
      achievement_text: values.text.trim(),
      achievement_entries: values.entries,
      achievement_sets: values.sets,
    })
    .select('id')
    .single()
  if (insertError) throw insertError
  return data
}
