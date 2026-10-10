// Publica um conjunto visual aprovado: copia os bytes do bucket privado de rascunhos para o bucket
// público exercise-visuals (Postgres não move bytes entre buckets), confirma que o destino existe e
// só então chama a RPC interna que, numa transação, arquiva a versão anterior, marca esta como
// published e atualiza exercise_catalog.published_media_refs. Nada é publicado automaticamente:
// só um superadmin, e só um conjunto que passou por `review`.
//
// Falhas parciais (a ordem é cópia -> RPC -> limpeza):
//  - cópia falha: nada mudou no banco; o conjunto continua em review e a publicação pode ser repetida
//    (o path publicado é determinístico por versão, então "já existe" na repetição é aceito).
//  - RPC falha depois da cópia: arquivos órfãos em exercise-visuals/{catalog}/v{n}/ (inofensivos: nada
//    aponta para eles) e o conjunto continua em review; repetir publica de novo.
//  - limpeza dos rascunhos falha: só sobra lixo no bucket privado; a publicação já valeu.
//  - idempotente: repetir uma publicação já concluída (resposta perdida) devolve sucesso.
//  - integridade (V2): o rascunho que vai para o bucket público precisa ter o SHA-256 gravado na confirmação
//    (conjuntos confirmados pela v1 não têm hash e seguem só com as demais validações).
import { corsHeaders } from '../_shared/cors.ts'
import { draftPath, FILE_NAMES, publishedPath } from '../_shared/exerciseVisualPaths.ts'
import { sha256Hex } from '../_shared/hash.ts'
import { findForbiddenWebpChunk, isWebpComplete, readWebpDimensions } from '../_shared/webp.ts'
import { authenticateSuperadmin, jsonError, jsonOk, UUID_PATTERN } from '../_shared/superadminAuth.ts'

const DRAFTS_BUCKET = 'exercise-visual-drafts'
const PUBLIC_BUCKET = 'exercise-visuals'
const MAX_BYTES = 2 * 1024 * 1024
const REQUIRED_ROLES = ['start', 'end']

function isAlreadyExists(error: { message?: string; statusCode?: string | number }) {
  return String(error.statusCode) === '409' || /already exists|Duplicate/i.test(error.message || '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await authenticateSuperadmin(req)
    if (auth instanceof Response) return auth
    const { uid, adminClient } = auth

    const { visualSetId } = await req.json()
    if (!UUID_PATTERN.test(String(visualSetId || ''))) return jsonError('INVALID_ARGUMENT', 400)

    const { data: set, error: setErr } = await adminClient
      .from('exercise_visual_sets')
      .select('id, catalog_id, version, status')
      .eq('id', visualSetId)
      .maybeSingle()
    if (setErr || !set) return jsonError('NOT_FOUND', 404)

    if (set.status === 'published') {
      const { data: catalog } = await adminClient
        .from('exercise_catalog')
        .select('published_media_refs')
        .eq('id', set.catalog_id)
        .maybeSingle()
      return jsonOk({
        visualSetId,
        publishedMediaRefs: catalog?.published_media_refs ?? null,
        alreadyPublished: true,
      })
    }
    if (set.status !== 'review') return jsonError('INVALID_STATE', 409)

    // Só os arquivos CONFIRMADOS (com metadados gravados pelo confirm) entram na publicação.
    const { data: assets, error: assetsErr } = await adminClient
      .from('exercise_visual_assets')
      .select('role, storage_bucket, storage_path, mime_type, byte_size, sha256')
      .eq('visual_set_id', visualSetId)
    if (assetsErr || !assets) return jsonError('INTERNAL_ERROR', 500)
    const confirmed = new Map(
      assets
        .filter((asset: { mime_type: string | null; byte_size: number | null }) => asset.mime_type === 'image/webp' && (asset.byte_size ?? 0) > 0)
        .map((asset: { role: string }) => [asset.role, asset])
    )
    if (!REQUIRED_ROLES.every((role) => confirmed.has(role))) return jsonError('INCOMPLETE_VISUAL_SET', 400)

    const draftPaths: string[] = []
    for (const role of Object.keys(FILE_NAMES)) {
      const asset = confirmed.get(role) as
        | { storage_bucket: string; storage_path: string; sha256: string | null }
        | undefined
      if (!asset) continue // miniatura ausente: segue só com start/end
      const source = draftPath(set.catalog_id, set.id, role)
      const target = publishedPath(set.catalog_id, set.version, role)
      if (!source || !target || asset.storage_bucket !== DRAFTS_BUCKET || asset.storage_path !== source) {
        return jsonError('INVALID_STATE', 409)
      }

      const { data: blob, error: downloadErr } = await adminClient.storage.from(DRAFTS_BUCKET).download(source)
      if (downloadErr || !blob) return jsonError('MISSING_FILE', 400)
      if (blob.size < 1 || blob.size > MAX_BYTES) return jsonError('INVALID_IMAGE', 400)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (!readWebpDimensions(bytes) || !isWebpComplete(bytes) || findForbiddenWebpChunk(bytes)) {
        return jsonError('INVALID_IMAGE', 400)
      }
      if (asset.sha256 && asset.sha256 !== (await sha256Hex(bytes))) {
        return jsonError('INTEGRITY_MISMATCH', 409)
      }

      const { error: uploadErr } = await adminClient.storage
        .from(PUBLIC_BUCKET)
        .upload(target, bytes, { contentType: 'image/webp', upsert: false })
      // Um retry depois de falha parcial encontra o arquivo já copiado: o conteúdo é o mesmo
      // (path determinístico por versão e draft imutável), então "já existe" não é erro.
      if (uploadErr && !isAlreadyExists(uploadErr)) {
        console.error('[publish-exercise-visual] upload failed:', uploadErr)
        return jsonError('COPY_FAILED', 502)
      }

      const { data: exists, error: existsErr } = await adminClient.storage.from(PUBLIC_BUCKET).exists(target)
      if (existsErr || !exists) return jsonError('COPY_FAILED', 502)
      draftPaths.push(source)
    }

    const { data: refs, error: publishErr } = await adminClient.rpc('publish_exercise_visual_internal', {
      p_set_id: visualSetId,
      p_actor: uid,
    })
    if (publishErr) {
      console.error('[publish-exercise-visual] publish_exercise_visual_internal failed:', publishErr)
      const known = ['INVALID_STATE', 'INVALID_TRANSITION', 'INCOMPLETE_VISUAL_SET', 'FORBIDDEN']
      return jsonError(known.includes(publishErr.message) ? publishErr.message : 'INTERNAL_ERROR', 409)
    }

    // Melhor esforço: os rascunhos já não são referenciados por ninguém (os assets agora apontam
    // para o bucket público). Inclui uma miniatura avulsa que tenha sido enviada mas não confirmada.
    const strayThumbnail = draftPath(set.catalog_id, set.id, 'thumbnail')
    if (strayThumbnail && !draftPaths.includes(strayThumbnail)) draftPaths.push(strayThumbnail)
    const { error: cleanupErr } = await adminClient.storage.from(DRAFTS_BUCKET).remove(draftPaths)
    if (cleanupErr) console.error('[publish-exercise-visual] draft cleanup failed:', cleanupErr)

    return jsonOk({ visualSetId, publishedMediaRefs: refs })
  } catch (error) {
    console.error('[publish-exercise-visual] unexpected error:', error)
    return jsonError('INTERNAL_ERROR', 500)
  }
})
