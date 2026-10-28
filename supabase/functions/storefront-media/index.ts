import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { readWebpDimensions, isWebpComplete, findForbiddenWebpChunk } from '../_shared/webp.ts'
const url = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const headers = { ...corsHeaders, 'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS', 'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const uuid = (v: unknown) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(v || ''))
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  const auth = req.headers.get('Authorization')
  const user = createClient(url, anon, { global: { headers: auth ? { Authorization: auth } : {} }, auth: { persistSession: false } })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  try {
    if (req.method === 'GET') {
      const id = new URL(req.url).searchParams.get('id')
      if (!uuid(id)) return json({ error: 'NOT_FOUND' }, 404)
      const access = await user.rpc('authorize_storefront_media', { p_media_id: id })
      if (access.error || !access.data) return json({ error: 'NOT_FOUND' }, 404)
      const image = await admin.storage.from('storefront-media').download(access.data)
      if (image.error || !image.data) return json({ error: 'NOT_FOUND' }, 404)
      // Revalidate after IO; expiry/suspension may have occurred during download.
      const current = await user.rpc('authorize_storefront_media', { p_media_id: id })
      if (current.error || current.data !== access.data) return json({ error: 'NOT_FOUND' }, 404)
      return new Response(image.data, { headers: { ...headers, 'Content-Type': 'image/webp', 'Content-Disposition': 'inline' } })
    }
    if (req.method === 'DELETE') {
      const id=new URL(req.url).searchParams.get('id')
      if(!auth || !uuid(id) || (await user.auth.getUser()).error) return json({error:'NOT_AUTHENTICATED'},401)
      const unused=await user.rpc('discard_unused_storefront_media',{p_media_id:id})
      if(unused.error) return json({error:unused.error.message},403)
      if(unused.data) {
        const removed=await admin.storage.from('storefront-media').remove([unused.data])
        if(removed.error)return json({error:'MEDIA_CLEANUP_PENDING'},503)
        await admin.rpc('discard_storefront_media_internal',{p_media_id:id})
      }
      return json({removed:Boolean(unused.data)})
    }
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    if (!auth || (await user.auth.getUser()).error) return json({ error: 'NOT_AUTHENTICATED' }, 401)
    // Bound bytes even with a forged/missing Content-Length, before multipart parsing.
    const reader = req.body?.getReader()
    if (!reader) return json({ error: 'INVALID_IMAGE' }, 400)
    const chunks: Uint8Array[] = []; let size = 0
    while (true) {
      const part = await reader.read(); if (part.done) break
      size += part.value.length
      if (size > 1100000) { await reader.cancel(); return json({ error: 'IMAGE_TOO_LARGE' }, 413) }
      chunks.push(part.value)
    }
    const body = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
    const form = await new Response(body, { headers: { 'Content-Type': req.headers.get('Content-Type') || '' } }).formData()
    const id = form.get('storefrontId'), file = form.get('image')
    if (!uuid(id) || !(file instanceof File) || file.type !== 'image/webp' || file.size < 1 || file.size > 1048576) return json({ error: 'INVALID_IMAGE' }, 400)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const dimensions = readWebpDimensions(bytes)
    if (!dimensions || !isWebpComplete(bytes) || findForbiddenWebpChunk(bytes) || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 1600 || dimensions.height > 1600) return json({ error: 'INVALID_IMAGE' }, 400)
    const allocation = await user.rpc('allocate_storefront_media', { p_id: id })
    if (allocation.error) return json({ error: allocation.error.message }, 403)
    const { id: mediaId, path } = allocation.data
    try {
      const uploaded = await admin.storage.from('storefront-media').upload(path, bytes, { contentType: 'image/webp', upsert: false, cacheControl: '0' })
      if (uploaded.error) throw uploaded.error
      const confirmed = await admin.rpc('confirm_storefront_media_internal', { p_media_id: mediaId, p_width: dimensions.width, p_height: dimensions.height, p_size: bytes.length })
      if (confirmed.error) throw confirmed.error
      return json({ mediaId })
    } catch {
      // The object was allocated by this request; never remove a caller-supplied path.
      const removed=await admin.storage.from('storefront-media').remove([path])
      if(!removed.error) await admin.rpc('discard_storefront_media_internal', { p_media_id: mediaId })
      return json({ error: 'UPLOAD_FAILED' }, 400)
    }
  } catch {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
})
