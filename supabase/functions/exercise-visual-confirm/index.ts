// Confirma um conjunto visual depois que o superadmin subiu os bytes direto pro bucket privado
// exercise-visual-drafts (a policy de insert já travou o upload nos paths reservados por
// allocate_exercise_visual_set). Só esta função decodifica o cabeçalho da imagem: Postgres não faz isso
// e o navegador não é confiável pra declarar as próprias dimensões. Equivalente ao profile-avatar-confirm.
//
//  - start e end são obrigatórios; a miniatura é esperada, mas se faltar/estiver inválida o conjunto
//    segue sem ela (uma falha secundária não pode deixar start/end válidos irrecuperáveis).
//  - Idempotente: repetir a chamada de um conjunto já em `review` (resposta perdida, duplo clique)
//    devolve sucesso em vez de erro.
import { corsHeaders } from '../_shared/cors.ts'
import { draftPath } from '../_shared/exerciseVisualPaths.ts'
import { isWebpComplete, readWebpDimensions } from '../_shared/webp.ts'
import { authenticateSuperadmin, jsonError, jsonOk, UUID_PATTERN } from '../_shared/superadminAuth.ts'

const DRAFTS_BUCKET = 'exercise-visual-drafts'
const MAX_BYTES = 2 * 1024 * 1024
const MIN_DIMENSION = 64
// start/end: até 1024x1024; thumbnail: até 512 (o cliente gera 320).
const MAX_DIMENSION: Record<string, number> = { start: 1024, end: 1024, thumbnail: 512 }
const REQUIRED_ROLES = ['start', 'end']

type Confirmed = { role: string; mime_type: string; width: number; height: number; byte_size: number }
type Failure = 'MISSING_FILE' | 'INVALID_IMAGE'

async function inspectAsset(
  adminClient: any,
  asset: { storage_bucket: string; storage_path: string } | undefined,
  expectedPath: string | null,
  role: string
): Promise<Confirmed | Failure> {
  // Path e bucket precisam ser exatamente os alocados: nada de ".." nem de arquivo de outro conjunto.
  if (!asset || !expectedPath || asset.storage_bucket !== DRAFTS_BUCKET || asset.storage_path !== expectedPath) {
    return 'INVALID_IMAGE'
  }
  const { data: blob, error } = await adminClient.storage.from(DRAFTS_BUCKET).download(expectedPath)
  if (error || !blob) return 'MISSING_FILE'
  if (blob.size < 1 || blob.size > MAX_BYTES) return 'INVALID_IMAGE'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const dimensions = readWebpDimensions(bytes)
  const max = MAX_DIMENSION[role]
  if (
    !dimensions ||
    !isWebpComplete(bytes) ||
    dimensions.width < MIN_DIMENSION ||
    dimensions.height < MIN_DIMENSION ||
    dimensions.width > max ||
    dimensions.height > max
  ) {
    return 'INVALID_IMAGE'
  }
  return { role, mime_type: 'image/webp', width: dimensions.width, height: dimensions.height, byte_size: bytes.length }
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
      .select('id, catalog_id, status, created_by')
      .eq('id', visualSetId)
      .maybeSingle()
    if (setErr || !set || set.created_by !== uid) return jsonError('UPLOAD_NOT_AUTHORIZED', 403)
    if (set.status === 'review') return jsonOk({ visualSetId, status: 'review', alreadyConfirmed: true })
    if (set.status !== 'allocated') return jsonError('UPLOAD_NOT_AUTHORIZED', 403)

    const { data: assets, error: assetsErr } = await adminClient
      .from('exercise_visual_assets')
      .select('role, storage_bucket, storage_path')
      .eq('visual_set_id', visualSetId)
    if (assetsErr || !assets) return jsonError('INTERNAL_ERROR', 500)
    const byRole = new Map(assets.map((asset: { role: string }) => [asset.role, asset]))
    if (!REQUIRED_ROLES.every((role) => byRole.has(role))) return jsonError('INCOMPLETE_VISUAL_SET', 400)

    const confirmed: Confirmed[] = []
    for (const role of REQUIRED_ROLES) {
      const result = await inspectAsset(
        adminClient,
        byRole.get(role) as any,
        draftPath(set.catalog_id, set.id, role),
        role
      )
      if (typeof result === 'string') return jsonError(result, 400)
      confirmed.push(result)
    }

    // Miniatura: melhor esforço. Sem ela (ou inválida) o conjunto segue só com start/end.
    if (byRole.has('thumbnail')) {
      const thumbnail = await inspectAsset(
        adminClient,
        byRole.get('thumbnail') as any,
        draftPath(set.catalog_id, set.id, 'thumbnail'),
        'thumbnail'
      )
      if (typeof thumbnail === 'string') {
        console.warn(`[exercise-visual-confirm] thumbnail ignorada (${thumbnail}) no conjunto ${set.id}`)
      } else {
        confirmed.push(thumbnail)
      }
    }

    const { data: result, error: confirmErr } = await adminClient.rpc(
      'confirm_exercise_visual_internal',
      { p_set_id: visualSetId, p_actor: uid, p_assets: confirmed }
    )
    if (confirmErr) {
      console.error('[exercise-visual-confirm] confirm_exercise_visual_internal failed:', confirmErr)
      return jsonError(
        confirmErr.message === 'UPLOAD_NOT_AUTHORIZED' ? 'UPLOAD_NOT_AUTHORIZED' : 'INTERNAL_ERROR',
        400
      )
    }

    return jsonOk(result)
  } catch (error) {
    console.error('[exercise-visual-confirm] unexpected error:', error)
    return jsonError('INTERNAL_ERROR', 500)
  }
})
