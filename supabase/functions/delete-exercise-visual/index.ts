import { corsHeaders } from '../_shared/cors.ts'
import {
  authenticateSuperadmin,
  jsonError,
  jsonOk,
  UUID_PATTERN,
} from '../_shared/superadminAuth.ts'
import { processVisualDeletions } from './worker.js'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('METHOD_NOT_ALLOWED', 405)
  try {
    const auth = await authenticateSuperadmin(req)
    if (auth instanceof Response) return auth
    const { visualSetId } = await req.json()
    if (!UUID_PATTERN.test(String(visualSetId || ''))) return jsonError('INVALID_ARGUMENT', 400)
    const { data: job, error } = await auth.adminClient
      .from('exercise_visual_deletions')
      .select('visual_set_id,status')
      .eq('visual_set_id', visualSetId)
      .maybeSingle()
    if (error || !job) return jsonError('NOT_FOUND', 404)
    if (job.status !== 'complete') await processVisualDeletions(auth.adminClient, visualSetId)
    const { data: final, error: finalError } = await auth.adminClient
      .from('exercise_visual_deletions')
      .select('status')
      .eq('visual_set_id', visualSetId)
      .maybeSingle()
    if (finalError || !final) return jsonError('DELETION_PENDING', 503)
    return jsonOk({ visualSetId, status: final.status, complete: final.status === 'complete' })
  } catch (error) {
    console.error('[delete-exercise-visual] deletion remains retryable:', error)
    return jsonError('DELETION_PENDING', 503)
  }
})
