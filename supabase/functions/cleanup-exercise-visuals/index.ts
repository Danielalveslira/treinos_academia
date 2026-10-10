// Limpeza de rascunhos abandonados de imagens de exercícios. Só superadmin (JWT), sob demanda ou agendada
// por quem tiver um token de superadmin (ver docs/EXERCISE_VISUALS.md). Nunca toca em published/archived:
// o banco só devolve candidatos failed/rejected e o bucket PÚBLICO nem é referenciado aqui.
//
// Ordem e tolerância a falhas (cada passo pode ser repetido; nenhum depende do anterior na mesma execução):
//  1. expire_stale_exercise_visual_sets: allocated/draft com mais de 48h -> failed (só banco, linha preservada).
//  2. list_exercise_visual_purge_candidates: failed (>7 dias) / rejected (>30 dias) com bytes ainda no bucket.
//  3. remove os bytes do bucket PRIVADO de rascunhos, só em paths recalculados ({catalog}/{set}/arquivo).
//  4. mark_exercise_visual_drafts_purged_internal: só depois do passo 3 dar certo. Se o passo 3 falhar, o
//     banco não é tocado e o próximo ciclo tenta de novo; se o passo 4 falhar, o próximo ciclo remove de novo
//     (remover objeto inexistente não é erro) e marca.
//  `dryRun: true` apenas lista; `limit` (1-200, padrão 100) limita o lote.
import { corsHeaders } from '../_shared/cors.ts'
import { draftPath } from '../_shared/exerciseVisualPaths.ts'
import { authenticateSuperadmin, jsonError, jsonOk } from '../_shared/superadminAuth.ts'

const DRAFTS_BUCKET = 'exercise-visual-drafts'

type Candidate = {
  visual_set_id: string
  catalog_id: string
  status: string
  assets: { role: string; path: string }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await authenticateSuperadmin(req)
    if (auth instanceof Response) return auth
    const { adminClient } = auth

    let body: { dryRun?: unknown; limit?: unknown } = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }
    const dryRun = body.dryRun === true
    const limit = Number.isInteger(body.limit) ? Math.min(Math.max(body.limit as number, 1), 200) : 100

    let expired = 0
    if (!dryRun) {
      const { data, error } = await adminClient.rpc('expire_stale_exercise_visual_sets', { p_limit: limit })
      if (error) console.error('[cleanup-exercise-visuals] expire failed:', error)
      else expired = Number(data) || 0
    }

    const { data: candidates, error: listErr } = await adminClient.rpc(
      'list_exercise_visual_purge_candidates',
      { p_limit: limit }
    )
    if (listErr) {
      console.error('[cleanup-exercise-visuals] list failed:', listErr)
      return jsonError('INTERNAL_ERROR', 500)
    }
    const rows = (candidates || []) as Candidate[]
    if (dryRun) return jsonOk({ dryRun: true, expired: 0, candidates: rows.length })

    let purged = 0
    let failed = 0
    let skipped = 0
    for (const row of rows) {
      // Nunca confia no path do banco: só remove o que é exatamente {catalog}/{set}/{arquivo} deste conjunto.
      if (!['failed', 'rejected'].includes(row.status)) {
        skipped++
        continue
      }
      const paths = row.assets.map((asset) => ({
        expected: draftPath(row.catalog_id, row.visual_set_id, asset.role),
        actual: asset.path,
      }))
      if (paths.some(({ expected, actual }) => !expected || expected !== actual)) {
        console.error(`[cleanup-exercise-visuals] paths inesperados no conjunto ${row.visual_set_id}; ignorado`)
        skipped++
        continue
      }
      if (paths.length) {
        const { error: removeErr } = await adminClient.storage
          .from(DRAFTS_BUCKET)
          .remove(paths.map(({ actual }) => actual))
        if (removeErr) {
          console.error(`[cleanup-exercise-visuals] remove falhou (${row.visual_set_id}):`, removeErr)
          failed++
          continue
        }
      }
      const { error: markErr } = await adminClient.rpc('mark_exercise_visual_drafts_purged_internal', {
        p_set_id: row.visual_set_id,
      })
      if (markErr) {
        console.error(`[cleanup-exercise-visuals] mark falhou (${row.visual_set_id}):`, markErr)
        failed++
      } else {
        purged++
      }
    }

    return jsonOk({ dryRun: false, expired, candidates: rows.length, purged, failed, skipped })
  } catch (error) {
    console.error('[cleanup-exercise-visuals] unexpected error:', error)
    return jsonError('INTERNAL_ERROR', 500)
  }
})
