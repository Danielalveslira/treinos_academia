// Homologação ponta a ponta do sistema de imagens dos exercícios contra uma stack Supabase REAL (Auth,
// PostgREST, Storage e Edge Functions via gateway) -- nunca mocks. Cobre os testes A (superadmin),
// B (usuário comum/anon/outro contexto), C (consulta do app, sem N+1) e a compatibilidade com o legado.
// Os testes de navegador (aplicação e offline) seguem o checklist C/D de docs/EXERCISE_VISUALS.md.
//
// NUNCA roda contra produção: exige HOMOLOG_CONFIRM=NOT_PRODUCTION e recusa o ref de produção conhecido.
//
//   HOMOLOG_CONFIRM=NOT_PRODUCTION HOMOLOG_URL=http://127.0.0.1:54321 HOMOLOG_ANON_KEY=... \
//   HOMOLOG_SERVICE_ROLE_KEY=... SA_EMAIL=... SA_PASSWORD=... SA2_EMAIL=... SA2_PASSWORD=... \
//   USER_EMAIL=... USER_PASSWORD=... FIXTURES_DIR=<dir com start.webp end.webp thumb.webp ...> \
//   node scripts/verify-exercise-visuals-homolog.mjs
//
// SA2 é um segundo superadmin (para "conjunto de outro admin"). Os usuários precisam já existir.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const PRODUCTION_REFS = ['ywrjojrjgozdfpddkkuy']
const env = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Defina ${name}`)
  return value
}

const URL_BASE = env('HOMOLOG_URL').replace(/\/+$/, '')
if (process.env.HOMOLOG_CONFIRM !== 'NOT_PRODUCTION') {
  throw new Error(
    'Recusado: defina HOMOLOG_CONFIRM=NOT_PRODUCTION (este script grava dados de teste).'
  )
}
if (PRODUCTION_REFS.some((ref) => URL_BASE.includes(ref))) {
  throw new Error(`Recusado: ${URL_BASE} é o projeto de PRODUÇÃO.`)
}
const ANON = env('HOMOLOG_ANON_KEY')
const SERVICE = env('HOMOLOG_SERVICE_ROLE_KEY')
const FIXTURES = env('FIXTURES_DIR')
const fixture = (name) => new Uint8Array(readFileSync(join(FIXTURES, name)))

const results = []
let currentSection = ''
const section = (name) => {
  currentSection = name
  console.log(`\n## ${name}`)
}
function check(description, ok, detail = '') {
  results.push({ section: currentSection, description, ok: Boolean(ok), detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${description}${detail ? `  -> ${detail}` : ''}`)
  return ok
}
const stat = (value) => value?.status ?? value?.statusCode ?? value?.code ?? '?'

const mk = () =>
  createClient(URL_BASE, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const service = createClient(URL_BASE, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function login(emailVar, passwordVar) {
  const client = mk()
  const { data, error } = await client.auth.signInWithPassword({
    email: env(emailVar),
    password: env(passwordVar),
  })
  if (error) throw new Error(`login ${emailVar}: ${error.message}`)
  return { client, token: data.session.access_token, id: data.user.id }
}

async function callFunction(name, token, body, { noAuth = false } = {}) {
  const response = await fetch(`${URL_BASE}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      ...(noAuth ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  })
  let json = null
  try {
    json = await response.json()
  } catch {
    json = null
  }
  return { status: response.status, body: json }
}

const upload = async (client, bucket, path, bytes, contentType = 'image/webp') => {
  const { error } = await client.storage
    .from(bucket)
    .upload(path, bytes, { contentType, upsert: false })
  return { ok: !error, status: error ? stat(error) : 200, message: error?.message }
}

async function catalogId(providerExerciseId) {
  const { data, error } = await service
    .from('exercise_catalog')
    .select('id, name')
    .eq('provider_exercise_id', providerExerciseId)
    .maybeSingle()
  if (error || !data) throw new Error(`exercício ${providerExerciseId} não encontrado no catálogo`)
  return data
}
const setRow = async (id) =>
  (
    await service
      .from('exercise_visual_sets')
      .select('*, assets:exercise_visual_assets(*)')
      .eq('id', id)
      .single()
  ).data
const catalogRefs = async (id) =>
  (
    await service
      .from('exercise_catalog')
      .select('published_media_refs, media_refs, source_media_refs')
      .eq('id', id)
      .single()
  ).data
const objects = async (bucket, prefix) =>
  ((await service.storage.from(bucket).list(prefix)).data || []).map((o) => o.name).sort()

async function allocate(sa, catalog, source = 'manual_upload') {
  const { data, error, status } = await sa.client.rpc('allocate_exercise_visual_set', {
    p_catalog_id: catalog,
    p_generation_source: source,
    p_prompt_version: 'v1',
    p_metadata: { tool: 'homolog' },
  })
  if (error) throw new Error(`allocate falhou (${status}): ${error.message}`)
  return data
}
async function putSet(sa, alloc, files) {
  for (const [role, file] of Object.entries(files)) {
    const result = await upload(
      sa.client,
      'exercise-visual-drafts',
      alloc.assets[role].path,
      fixture(file)
    )
    if (!result.ok) throw new Error(`upload ${role}: ${result.message}`)
  }
}
const publicUrl = (path) => `${URL_BASE}/storage/v1/object/public/exercise-visuals/${path}`

async function main() {
  const sa = await login('SA_EMAIL', 'SA_PASSWORD')
  const sa2 = await login('SA2_EMAIL', 'SA2_PASSWORD')
  const user = await login('USER_EMAIL', 'USER_PASSWORD')
  const anon = mk()

  const X = await catalogId('Pushups')
  const Y = await catalogId('Plank')
  const Z = await catalogId('Barbell_Curl')
  const W = await catalogId('Dumbbell_Bicep_Curl')
  const V = await catalogId('Leg_Press')

  // ------------------------------------------------------------------------------------------------
  section('A. Superadmin — fluxo completo (V1 com miniatura)')
  const before = await catalogRefs(X.id)
  check(
    'estado inicial: published_media_refs vazio e media_refs legado presente',
    JSON.stringify(before.published_media_refs) === '{"images": []}' ||
      before.published_media_refs?.images?.length === 0,
    JSON.stringify(before.published_media_refs)
  )
  const a1 = await allocate(sa, X.id)
  check(
    'allocation: versão 1 e 3 assets reservados',
    a1.version === 1 && Object.keys(a1.assets).sort().join() === 'end,start,thumbnail',
    JSON.stringify(a1.assets.start)
  )
  check(
    'paths de draft = {catalog}/{set}/{arquivo}',
    a1.assets.start.path === `${X.id}/${a1.visualSetId}/start.webp`
  )
  check('status inicial allocated', (await setRow(a1.visualSetId)).status === 'allocated')

  const bad = await upload(
    sa.client,
    'exercise-visual-drafts',
    `${X.id}/${a1.visualSetId}/inventado.webp`,
    fixture('start.webp')
  )
  check('upload em path NÃO alocado é recusado pelo Storage', !bad.ok, `status ${bad.status}`)
  const pub = await upload(
    sa.client,
    'exercise-visuals',
    `${X.id}/v1/start.webp`,
    fixture('start.webp')
  )
  check('cliente não escreve no bucket público', !pub.ok, `status ${pub.status}`)

  const up1 = await upload(
    sa.client,
    'exercise-visual-drafts',
    a1.assets.start.path,
    fixture('start.webp')
  )
  check('upload start.webp no Storage real', up1.ok, `status ${up1.status}`)
  const re = await upload(
    sa.client,
    'exercise-visual-drafts',
    a1.assets.start.path,
    fixture('end.webp')
  )
  check('sobrescrever o mesmo path é recusado (rascunho imutável)', !re.ok, `status ${re.status}`)
  const up2 = await upload(
    sa.client,
    'exercise-visual-drafts',
    a1.assets.end.path,
    fixture('end.webp')
  )
  const up3 = await upload(
    sa.client,
    'exercise-visual-drafts',
    a1.assets.thumbnail.path,
    fixture('thumb.webp')
  )
  check('upload end.webp e thumb.webp', up2.ok && up3.ok, `end ${up2.status} thumb ${up3.status}`)

  const c1 = await callFunction('exercise-visual-confirm', sa.token, {
    visualSetId: a1.visualSetId,
  })
  check(
    'confirmação (Edge Function real) 200',
    c1.status === 200 && c1.body?.status === 'review',
    `${c1.status} ${JSON.stringify(c1.body)}`
  )
  const s1 = await setRow(a1.visualSetId)
  check(
    'status review e 3 assets com medidas lidas no servidor',
    s1.status === 'review' &&
      s1.assets.length === 3 &&
      s1.assets.every((a) => a.mime_type === 'image/webp' && a.width > 0 && a.byte_size > 0),
    s1.assets.map((a) => `${a.role}:${a.width}x${a.height}/${a.byte_size}`).join(' ')
  )
  check(
    'start/end 1024x1024 e thumbnail 320x320',
    s1.assets
      .filter((a) => a.role !== 'thumbnail')
      .every((a) => a.width === 1024 && a.height === 1024) &&
      s1.assets.find((a) => a.role === 'thumbnail').width === 320
  )
  const c1b = await callFunction('exercise-visual-confirm', sa.token, {
    visualSetId: a1.visualSetId,
  })
  check(
    'idempotência da confirmação',
    c1b.status === 200 && c1b.body?.alreadyConfirmed === true,
    `${c1b.status} ${JSON.stringify(c1b.body)}`
  )
  check(
    'published_media_refs NÃO muda antes de publicar',
    (await catalogRefs(X.id)).published_media_refs.version === undefined
  )

  const p1 = await callFunction('publish-exercise-visual', sa.token, {
    visualSetId: a1.visualSetId,
  })
  check(
    'publicação (Edge Function real) 200',
    p1.status === 200 && p1.body?.publishedMediaRefs?.version === 1,
    `${p1.status} ${JSON.stringify(p1.body)}`
  )
  const r1 = (await catalogRefs(X.id)).published_media_refs
  check(
    'published_media_refs = v1 com start, end e thumbnail',
    r1.version === 1 &&
      r1.images.map((i) => i.path).join() === `${X.id}/v1/start.webp,${X.id}/v1/end.webp` &&
      r1.thumbnail?.path === `${X.id}/v1/thumb.webp`,
    JSON.stringify(r1)
  )
  check(
    'arquivos copiados para exercise-visuals/{catalog}/v1/',
    (await objects('exercise-visuals', `${X.id}/v1`)).join() === 'end.webp,start.webp,thumb.webp'
  )
  check(
    'rascunhos removidos do bucket privado',
    (await objects('exercise-visual-drafts', `${X.id}/${a1.visualSetId}`)).length === 0
  )
  const s1p = await setRow(a1.visualSetId)
  check(
    'set published, approved_by/approved_at/published_at e assets no bucket público',
    s1p.status === 'published' &&
      s1p.approved_by === sa.id &&
      s1p.approved_at &&
      s1p.published_at &&
      s1p.assets.every((a) => a.storage_bucket === 'exercise-visuals')
  )

  const urlStart = await fetch(publicUrl(`${X.id}/v1/start.webp`))
  const bytes = new Uint8Array(await urlStart.arrayBuffer())
  check(
    'URL pública (sem login) devolve a imagem',
    urlStart.status === 200 &&
      urlStart.headers.get('content-type')?.startsWith('image/webp') &&
      bytes.length === fixture('start.webp').length,
    `${urlStart.status} ${urlStart.headers.get('content-type')} ${bytes.length}B`
  )
  const corsFetch = await fetch(publicUrl(`${X.id}/v1/end.webp`), {
    headers: { Origin: 'https://app.example' },
  })
  check(
    'URL pública responde com CORS (necessário ao cache do Service Worker)',
    corsFetch.headers.get('access-control-allow-origin') !== null,
    `acao=${corsFetch.headers.get('access-control-allow-origin')}`
  )
  const p1b = await callFunction('publish-exercise-visual', sa.token, {
    visualSetId: a1.visualSetId,
  })
  check(
    'idempotência da publicação',
    p1b.status === 200 && p1b.body?.alreadyPublished === true,
    `${p1b.status} ${JSON.stringify(p1b.body?.alreadyPublished)}`
  )

  section('A. V2 → arquivamento da V1 → rollback')
  const a2 = await allocate(sa, X.id)
  check('V2 recebe versão 2', a2.version === 2)
  await putSet(sa, a2, { start: 'start2.webp', end: 'end2.webp', thumbnail: 'thumb2.webp' })
  const c2 = await callFunction('exercise-visual-confirm', sa.token, {
    visualSetId: a2.visualSetId,
  })
  check('V2 confirmada → review', c2.status === 200)
  check(
    'V2 em review não altera o catálogo (ainda v1)',
    (await catalogRefs(X.id)).published_media_refs.version === 1
  )
  const p2 = await callFunction('publish-exercise-visual', sa.token, {
    visualSetId: a2.visualSetId,
  })
  check('V2 publicada', p2.status === 200)
  const sets = (
    await service
      .from('exercise_visual_sets')
      .select('version,status')
      .eq('catalog_id', X.id)
      .order('version')
  ).data
  check(
    'V1 archived, V2 published, só uma published',
    sets.map((s) => `${s.version}:${s.status}`).join() === '1:archived,2:published',
    sets.map((s) => `${s.version}:${s.status}`).join()
  )
  check('published_media_refs = v2', (await catalogRefs(X.id)).published_media_refs.version === 2)
  check(
    'arquivos da V1 continuam no público (rollback sem regenerar)',
    (await objects('exercise-visuals', `${X.id}/v1`)).length === 3 &&
      (await fetch(publicUrl(`${X.id}/v1/start.webp`))).status === 200
  )
  check(
    'URLs da V2 funcionam e diferem das da V1',
    (await fetch(publicUrl(`${X.id}/v2/start.webp`))).status === 200
  )

  const rb = await sa.client.rpc('restore_exercise_visual_version', { p_set_id: a1.visualSetId })
  check(
    'rollback para a V1 (RPC)',
    !rb.error && rb.data?.version === 1,
    `${rb.status} ${rb.error?.message || JSON.stringify(rb.data)}`
  )
  const setsAfter = (
    await service
      .from('exercise_visual_sets')
      .select('version,status')
      .eq('catalog_id', X.id)
      .order('version')
  ).data
  check(
    'V1 published, V2 archived após rollback',
    setsAfter.map((s) => `${s.version}:${s.status}`).join() === '1:published,2:archived'
  )
  const rr = (await catalogRefs(X.id)).published_media_refs
  check(
    'published_media_refs voltou ao conjunto EXATO da V1 (inclui thumbnail v1)',
    rr.version === 1 &&
      rr.thumbnail.path === `${X.id}/v1/thumb.webp` &&
      rr.images[0].path === `${X.id}/v1/start.webp`
  )
  const rb2 = await sa.client.rpc('restore_exercise_visual_version', { p_set_id: a1.visualSetId })
  check(
    'restaurar a versão já publicada é recusado (INVALID_STATE)',
    rb2.error?.message === 'INVALID_STATE',
    `${rb2.status} ${rb2.error?.message}`
  )
  const rb3 = await sa.client.rpc('restore_exercise_visual_version', { p_set_id: a2.visualSetId })
  check(
    'rollback de volta para a V2',
    !rb3.error && (await catalogRefs(X.id)).published_media_refs.version === 2
  )
  await sa.client.rpc('restore_exercise_visual_version', { p_set_id: a1.visualSetId })

  section('A. Fluxo SEM miniatura')
  const a3 = await allocate(sa, Y.id)
  await putSet(sa, a3, { start: 'start.webp', end: 'end.webp' })
  const c3 = await callFunction('exercise-visual-confirm', sa.token, {
    visualSetId: a3.visualSetId,
  })
  check(
    'confirm sem thumbnail aceito (hasThumbnail=false)',
    c3.status === 200 && c3.body?.hasThumbnail === false,
    `${c3.status} ${JSON.stringify(c3.body)}`
  )
  check(
    'linha da miniatura removida (2 assets)',
    (await setRow(a3.visualSetId)).assets.length === 2
  )
  const p3 = await callFunction('publish-exercise-visual', sa.token, {
    visualSetId: a3.visualSetId,
  })
  check('publica sem miniatura', p3.status === 200)
  const r3 = (await catalogRefs(Y.id)).published_media_refs
  check(
    'published_media_refs sem a chave thumbnail',
    r3.version === 1 && !('thumbnail' in r3) && r3.images.length === 2,
    JSON.stringify(r3)
  )
  check(
    'start/end públicos e thumb inexistente',
    (await fetch(publicUrl(`${Y.id}/v1/start.webp`))).status === 200 &&
      (await fetch(publicUrl(`${Y.id}/v1/thumb.webp`))).status !== 200
  )

  section('A. Miniatura inválida (truncada) não derruba o conjunto')
  const a4 = await allocate(sa, Z.id)
  await putSet(sa, a4, { start: 'start.webp', end: 'end.webp', thumbnail: 'truncated.webp' })
  const c4 = await callFunction('exercise-visual-confirm', sa.token, {
    visualSetId: a4.visualSetId,
  })
  check(
    'confirm ignora a miniatura inválida e segue com start/end',
    c4.status === 200 && c4.body?.hasThumbnail === false,
    `${c4.status} ${JSON.stringify(c4.body)}`
  )
  const p4 = await callFunction('publish-exercise-visual', sa.token, {
    visualSetId: a4.visualSetId,
  })
  check(
    'publica e limpa a miniatura avulsa do rascunho',
    p4.status === 200 &&
      (await objects('exercise-visual-drafts', `${Z.id}/${a4.visualSetId}`)).length === 0,
    `${p4.status}`
  )

  section('A. Arquivo ausente / truncado / inválido / path incorreto')
  const a5 = await allocate(sa, W.id)
  await putSet(sa, a5, { start: 'start.webp' })
  const c5 = await callFunction('exercise-visual-confirm', sa.token, {
    visualSetId: a5.visualSetId,
  })
  check(
    'arquivo ausente (end) → 400 MISSING_FILE',
    c5.status === 400 && c5.body?.error === 'MISSING_FILE',
    `${c5.status} ${JSON.stringify(c5.body)}`
  )
  check(
    'set continua allocated (nada pela metade)',
    (await setRow(a5.visualSetId)).status === 'allocated'
  )
  await putSet(sa, a5, { end: 'end.webp' })
  const c5b = await callFunction('exercise-visual-confirm', sa.token, {
    visualSetId: a5.visualSetId,
  })
  check(
    'upload incompleto é recuperável: enviar o que faltava e confirmar',
    c5b.status === 200,
    `${c5b.status}`
  )

  const invalidCases = [
    ['arquivo truncado', 'truncated.webp'],
    ['PNG renomeado como WebP', 'not_webp.png'],
    ['HTML renomeado como WebP', 'html_as_webp.webp'],
    ['dimensão acima do limite (2000px)', 'too_big.webp'],
    ['dimensão abaixo do mínimo (32px)', 'tiny.webp'],
  ]
  for (const [label, file] of invalidCases) {
    const alloc = await allocate(sa, V.id)
    await putSet(sa, alloc, { start: file, end: 'end.webp' })
    const result = await callFunction('exercise-visual-confirm', sa.token, {
      visualSetId: alloc.visualSetId,
    })
    check(
      `${label} → 400 INVALID_IMAGE`,
      result.status === 400 && result.body?.error === 'INVALID_IMAGE',
      `${result.status} ${JSON.stringify(result.body)}`
    )
    check(
      `  ${label}: set continua allocated e nada é publicado`,
      (await setRow(alloc.visualSetId)).status === 'allocated' &&
        !(await catalogRefs(V.id)).published_media_refs.version
    )
  }

  const a6 = await allocate(sa, V.id)
  await putSet(sa, a6, { start: 'start.webp', end: 'end.webp', thumbnail: 'thumb.webp' })
  const startRow = (await setRow(a6.visualSetId)).assets.find((a) => a.role === 'start')
  for (const evil of [
    '../outro/start.webp',
    `${V.id}/${a6.visualSetId}/../start.webp`,
    `/${V.id}/${a6.visualSetId}/start.webp`,
  ]) {
    await service
      .from('exercise_visual_assets')
      .update({ storage_path: evil })
      .eq('id', startRow.id)
    const result = await callFunction('exercise-visual-confirm', sa.token, {
      visualSetId: a6.visualSetId,
    })
    check(
      `path adulterado "${evil}" → 400 INVALID_IMAGE`,
      result.status === 400 && result.body?.error === 'INVALID_IMAGE',
      `${result.status} ${JSON.stringify(result.body)}`
    )
  }
  await service
    .from('exercise_visual_assets')
    .update({ storage_path: startRow.storage_path })
    .eq('id', startRow.id)
  const c6 = await callFunction('exercise-visual-confirm', sa.token, {
    visualSetId: a6.visualSetId,
  })
  check('com o path correto restaurado, o mesmo conjunto confirma', c6.status === 200)

  section('A. Falha parcial: destino já copiado antes da publicação (retry)')
  const Q = await catalogId('Pullups')
  const a7 = await allocate(sa, Q.id)
  await putSet(sa, a7, { start: 'start.webp', end: 'end.webp', thumbnail: 'thumb.webp' })
  check(
    'conjunto confirmado',
    (await callFunction('exercise-visual-confirm', sa.token, { visualSetId: a7.visualSetId }))
      .status === 200
  )
  const orphan = await service.storage
    .from('exercise-visuals')
    .upload(`${Q.id}/v1/start.webp`, fixture('start.webp'), {
      contentType: 'image/webp',
      upsert: false,
    })
  check(
    '(simulação) arquivo de destino já existe, como depois de uma cópia parcial',
    !orphan.error,
    orphan.error?.message
  )
  const p7 = await callFunction('publish-exercise-visual', sa.token, {
    visualSetId: a7.visualSetId,
  })
  check(
    'publicar de novo com destino pré-existente conclui (Storage real devolve "já existe")',
    p7.status === 200,
    `${p7.status} ${JSON.stringify(p7.body)}`
  )
  check(
    'os 3 arquivos estão no público e o catálogo aponta para v1',
    (await objects('exercise-visuals', `${Q.id}/v1`)).join() === 'end.webp,start.webp,thumb.webp' &&
      (await catalogRefs(Q.id)).published_media_refs.version === 1
  )

  section('A. Rejeição e estados')
  const rj = await sa.client.rpc('reject_exercise_visual_set', {
    p_set_id: a6.visualSetId,
    p_reason: 'anatomia errada',
  })
  check(
    'rejeitar conjunto em review',
    !rj.error && (await setRow(a6.visualSetId)).status === 'rejected',
    `${rj.status} ${rj.error?.message || ''}`
  )
  const pr = await callFunction('publish-exercise-visual', sa.token, {
    visualSetId: a6.visualSetId,
  })
  check(
    'publicar conjunto rejeitado → 409 INVALID_STATE',
    pr.status === 409 && pr.body?.error === 'INVALID_STATE',
    `${pr.status} ${JSON.stringify(pr.body)}`
  )
  const pa = await callFunction('publish-exercise-visual', sa.token, {
    visualSetId: a5.visualSetId,
  })
  check('publicar o conjunto de W (review) funciona', pa.status === 200)
  const al = await allocate(sa, V.id)
  const pal = await callFunction('publish-exercise-visual', sa.token, {
    visualSetId: al.visualSetId,
  })
  check(
    'publicar conjunto ainda allocated → 409 INVALID_STATE',
    pal.status === 409 && pal.body?.error === 'INVALID_STATE',
    `${pal.status}`
  )
  const cr = await callFunction('exercise-visual-confirm', sa.token, {
    visualSetId: a6.visualSetId,
  })
  check('confirmar conjunto rejeitado → 403', cr.status === 403, `${cr.status}`)

  // ------------------------------------------------------------------------------------------------
  section('B. Usuário comum — nada pode funcionar (status registrado)')
  const live = await allocate(sa, V.id) // conjunto allocated do superadmin, alvo das tentativas
  await putSet(sa, live, { start: 'start.webp', end: 'end.webp', thumbnail: 'thumb.webp' })
  const reviewSet = a1.visualSetId

  const u1 = await user.client.rpc('allocate_exercise_visual_set', { p_catalog_id: V.id })
  check(
    'alocar → recusado',
    u1.error?.message === 'FORBIDDEN',
    `HTTP ${u1.status} code=${u1.error?.code} msg=${u1.error?.message}`
  )
  const u2 = await upload(
    user.client,
    'exercise-visual-drafts',
    `${V.id}/${live.visualSetId}/start.webp`,
    fixture('start.webp')
  )
  check(
    'enviar draft em path alocado do superadmin → recusado',
    !u2.ok,
    `status ${u2.status} ${u2.message}`
  )
  const u2b = await upload(
    user.client,
    'exercise-visual-drafts',
    'qualquer/coisa.webp',
    fixture('start.webp')
  )
  check(
    'enviar draft em path arbitrário → recusado',
    !u2b.ok,
    `status ${u2b.status} ${u2b.message}`
  )
  const u2c = await upload(
    user.client,
    'exercise-visuals',
    `${V.id}/v9/start.webp`,
    fixture('start.webp')
  )
  check('escrever no bucket público → recusado', !u2c.ok, `status ${u2c.status}`)
  const u3 = await callFunction('exercise-visual-confirm', user.token, {
    visualSetId: live.visualSetId,
  })
  check(
    'confirmar (função) → 403 FORBIDDEN',
    u3.status === 403 && u3.body?.error === 'FORBIDDEN',
    `HTTP ${u3.status} ${JSON.stringify(u3.body)}`
  )
  const u4 = await callFunction('publish-exercise-visual', user.token, { visualSetId: reviewSet })
  check(
    'publicar (função) → 403 FORBIDDEN',
    u4.status === 403 && u4.body?.error === 'FORBIDDEN',
    `HTTP ${u4.status} ${JSON.stringify(u4.body)}`
  )
  const u5 = await user.client.rpc('reject_exercise_visual_set', {
    p_set_id: reviewSet,
    p_reason: 'x',
  })
  check(
    'rejeitar (RPC) → FORBIDDEN',
    u5.error?.message === 'FORBIDDEN',
    `HTTP ${u5.status} code=${u5.error?.code}`
  )
  const u6 = await user.client.rpc('restore_exercise_visual_version', { p_set_id: a2.visualSetId })
  check(
    'restaurar versão (RPC) → FORBIDDEN',
    u6.error?.message === 'FORBIDDEN',
    `HTTP ${u6.status} code=${u6.error?.code}`
  )
  const u7 = await user.client.rpc('publish_exercise_visual_internal', {
    p_set_id: reviewSet,
    p_actor: sa.id,
  })
  const u8 = await user.client.rpc('confirm_exercise_visual_internal', {
    p_set_id: live.visualSetId,
    p_actor: sa.id,
    p_assets: [],
  })
  check(
    'RPCs internas não são chamáveis por authenticated',
    Boolean(u7.error) && Boolean(u8.error),
    `publish HTTP ${u7.status} ${u7.error?.code}; confirm HTTP ${u8.status} ${u8.error?.code}`
  )

  const lst = await user.client.storage
    .from('exercise-visual-drafts')
    .list(`${V.id}/${live.visualSetId}`)
  check(
    'listar bucket privado de drafts → vazio',
    (lst.data || []).length === 0,
    `HTTP ${stat(lst.error)} itens=${(lst.data || []).length}`
  )
  const dl = await user.client.storage
    .from('exercise-visual-drafts')
    .download(`${V.id}/${live.visualSetId}/start.webp`)
  check('baixar draft de outro → recusado', Boolean(dl.error), `status ${stat(dl.error)}`)
  const sg = await user.client.storage
    .from('exercise-visual-drafts')
    .createSignedUrl(`${V.id}/${live.visualSetId}/start.webp`, 60)
  check('assinar URL de draft → recusado', Boolean(sg.error), `status ${stat(sg.error)}`)
  const rf = await user.client.storage.from('exercise-visual-references').list('')
  check(
    'listar bucket de referências → vazio',
    (rf.data || []).length === 0,
    `status ${stat(rf.error)}`
  )
  const rs = await user.client.from('exercise_visual_sets').select('id')
  const ra = await user.client.from('exercise_visual_assets').select('id')
  const rp = await user.client.from('exercise_visual_style_profiles').select('id')
  check(
    'ler sets/assets/style profiles → 0 linhas (RLS)',
    [rs, ra, rp].every((r) => !r.error && r.data.length === 0),
    `sets=${rs.data?.length} assets=${ra.data?.length} profiles=${rp.data?.length}`
  )
  const w1 = await user.client.from('exercise_visual_sets').insert({
    catalog_id: V.id,
    version: 99,
    status: 'published',
    generation_source: 'manual_upload',
  })
  const w2 = await user.client
    .from('exercise_visual_sets')
    .update({ status: 'published' })
    .eq('id', reviewSet)
  // exercise_catalog tem RLS só de leitura: o UPDATE chega a ser aceito pelo PostgREST (grant padrão do
  // Supabase) mas o RLS filtra TODAS as linhas -- o critério é "0 linhas afetadas", não um erro HTTP.
  const w3 = await user.client
    .from('exercise_catalog')
    .update({ published_media_refs: { version: 666, images: [] } })
    .eq('id', V.id)
    .select('id')
  check(
    'escrever direto em sets → recusado; alterar published_media_refs → 0 linhas afetadas',
    Boolean(w1.error) && Boolean(w2.error) && !w3.error && w3.data.length === 0,
    `insert sets HTTP ${w1.status}; update sets HTTP ${w2.status} err=${w2.error?.code}; update catalog HTTP ${w3.status} linhas=${w3.data?.length}`
  )
  check(
    'nada foi alterado pelo usuário comum',
    (await setRow(reviewSet)).status === 'published' &&
      (await catalogRefs(V.id)).published_media_refs.version === undefined
  )

  section('B. Outro contexto: outro superadmin, anon e sem JWT')
  const o1 = await callFunction('exercise-visual-confirm', sa2.token, {
    visualSetId: live.visualSetId,
  })
  check(
    'outro superadmin NÃO confirma o conjunto alheio → 403 UPLOAD_NOT_AUTHORIZED',
    o1.status === 403 && o1.body?.error === 'UPLOAD_NOT_AUTHORIZED',
    `${o1.status} ${JSON.stringify(o1.body)}`
  )
  const o2 = await upload(
    sa2.client,
    'exercise-visual-drafts',
    `${V.id}/${live.visualSetId}/start2.webp`,
    fixture('start.webp')
  )
  check('outro superadmin NÃO sobe em path de conjunto alheio', !o2.ok, `status ${o2.status}`)
  const o3 = await callFunction(
    'exercise-visual-confirm',
    '',
    { visualSetId: live.visualSetId },
    { noAuth: true }
  )
  const o4 = await callFunction('publish-exercise-visual', ANON, { visualSetId: reviewSet })
  check(
    'sem JWT → 401; com anon key (sem usuário) → 401',
    o3.status === 401 && o4.status === 401,
    `sem JWT ${o3.status}; anon ${o4.status}`
  )
  const an1 = await anon.rpc('allocate_exercise_visual_set', { p_catalog_id: V.id })
  const an2 = await anon.storage.from('exercise-visual-drafts').list('')
  const an3 = await anon.from('exercise_visual_sets').select('id')
  check(
    'anon: RPC recusada, drafts vazios, sets sem acesso',
    Boolean(an1.error) &&
      (an2.data || []).length === 0 &&
      (Boolean(an3.error) || an3.data.length === 0),
    `rpc HTTP ${an1.status}; list ${stat(an2.error)}; sets HTTP ${an3.status}`
  )
  const an4 = await anon
    .from('exercise_catalog')
    .select('id, published_media_refs')
    .eq('id', X.id)
    .single()
  check(
    'anon continua lendo o catálogo (incl. published_media_refs) e a mídia pública',
    !an4.error &&
      an4.data.published_media_refs.version === 1 &&
      (await fetch(publicUrl(`${X.id}/v1/start.webp`))).status === 200
  )
  check(
    'o conjunto do superadmin segue intacto (allocated)',
    (await setRow(live.visualSetId)).status === 'allocated'
  )

  // ------------------------------------------------------------------------------------------------
  section('C. Aplicação — consultas do aluno sem N+1')
  let requests = 0
  const counting = createClient(URL_BASE, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        requests += 1
        return fetch(input, init)
      },
    },
  })
  const search = await counting.rpc('search_exercise_catalog', {
    p_query: null,
    p_limit: 20,
    p_offset: 0,
  })
  check(
    'busca paginada do catálogo = 1 requisição, já com published_media_refs',
    requests === 1 &&
      !search.error &&
      search.data.length === 20 &&
      'published_media_refs' in search.data[0],
    `requisições=${requests}`
  )
  requests = 0
  const withMedia = await counting.rpc('search_exercise_catalog', {
    p_query: 'Flex',
    p_limit: 50,
    p_offset: 0,
  })
  check(
    'busca que inclui exercício publicado traz o conjunto na mesma requisição',
    requests === 1 && withMedia.data.some((r) => r.published_media_refs?.version === 1),
    `requisições=${requests}`
  )
  requests = 0
  const detail = await counting
    .from('exercise_catalog')
    .select(
      'id, provider, provider_exercise_id, name, primary_muscle, muscles, equipment, category, difficulty, force, mechanic, instructions, published_media_refs'
    )
    .eq('id', X.id)
    .maybeSingle()
  check(
    'detalhe do exercício = 1 requisição com published_media_refs',
    requests === 1 && detail.data?.published_media_refs?.version === 1,
    `requisições=${requests}`
  )

  // ------------------------------------------------------------------------------------------------
  section('Compatibilidade — frontend/importador legados')
  const legacyDetail = await anon
    .from('exercise_catalog')
    .select(
      'id, provider, provider_exercise_id, name, primary_muscle, muscles, equipment, category, difficulty, force, mechanic, instructions, media_refs'
    )
    .eq('id', X.id)
    .maybeSingle()
  check(
    'consulta LEGADA (select media_refs) continua funcionando',
    !legacyDetail.error && 'media_refs' in legacyDetail.data,
    `HTTP ${legacyDetail.status}`
  )
  const legacyRpc = await anon.rpc('search_exercise_catalog', { p_query: 'Flexões', p_limit: 5 })
  check(
    'RPC continua devolvendo media_refs (frontend legado) e total_count',
    !legacyRpc.error && 'media_refs' in legacyRpc.data[0] && 'total_count' in legacyRpc.data[0]
  )
  const refsBefore = await catalogRefs(X.id)
  check(
    'media_refs legado intacto',
    JSON.stringify(refsBefore.media_refs) === '{}' || refsBefore.media_refs !== undefined,
    JSON.stringify(refsBefore.media_refs)
  )
  check(
    'source_media_refs contém as referências do dataset',
    Array.isArray(refsBefore.source_media_refs?.images) &&
      refsBefore.source_media_refs.images.length > 0,
    JSON.stringify(refsBefore.source_media_refs)
  )

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\n==== ${results.length - failed.length}/${results.length} verificações passaram${failed.length ? `; ${failed.length} FALHARAM` : ''} ====`
  )
  for (const r of failed) console.log(`FAIL [${r.section}] ${r.description} -> ${r.detail}`)
  process.exitCode = failed.length ? 1 : 0
}

await main().catch((error) => {
  console.error('ERRO FATAL:', error)
  process.exitCode = 2
})
